/**
 * @module AgentUnit/AgentUnit
 * @description AgentUnit<T> — the core monad for agent composition.
 *   A lazy, type-safe monad representing a computation producing a value of type T.
 *   Operators are injected via prototype augmentation from ./operators/index.
 * @blast_radius HIGH — every agent in the system depends on this class.
 * @status STABLE
 * @rules @.cursor/rules/frameworks/206-symplek-framework.mdc
 * @runtime node
 * @surface internal
 */

import type { z } from "zod";
import type { HasVotes } from "../coherence/types";
import type { ContractOptions } from "../contract";
import { IdempotencyStoreWriteError, SymplekError } from "../errors";
import {
  _idempotencyInFlight,
  buildFlightKey,
  defaultIdempotencyStore,
  IdempotencyError,
  type IdempotencyStore,
} from "../idempotency";
import type {
  InterviewConfig,
  InterviewHandlers,
  InterviewPending,
  InterviewResult,
} from "../interview/types";
import type {
  ExecutionTrace,
  RecorderOptions,
  RehearsalResult,
  ReplayerOptions,
  ReplayResult,
} from "../rehearsal/types";
import type { SoloConfig, SoloResult } from "../solo/types";
import type {
  AdvisorAgent,
  AgentContext,
  CoherenceOptions,
  CoherenceResult,
  ConsensusOptions,
  ConsensusResult,
  ConvergentAgent,
  ConvergeOptions,
  ConvergeResult,
  DebateAgent,
  DebateOptions,
  DebateResult,
  DialecticOptions,
  DialecticResult,
  LeaderAgent,
  ReflectOptions,
  ReflectResult,
  RetryOptions,
  RunOptionsWithTrust,
  SourceTrackingOptions,
  TrackedResult,
  TrustMode,
  VoteInput,
} from "../types";
import { isTrackedResult } from "../trust";
import { handleError } from "./errorEnhancement";
import {
  type AgentComputation,
  type AgentUnitMetadata,
  generateId,
} from "./metadata";
import type { CompensateFn } from "./operators/compensate";
import type { SagaStep } from "./operators/saga";
import type {
  SupervisedDecision,
  SupervisedOptions,
} from "./operators/supervised";
import { emitDeprecationWarning, wrapInTrackedResult } from "./zeroTrust";

export type { AgentComputation, AgentUnitMetadata };
export { generateId } from "./metadata";

/**
 * AgentUnit<T> - A lazy, type-safe monad for composing agent operations.
 *
 * @remarks
 * AgentUnit is lazy — nothing executes until `.run()` is called.
 * All operators return new AgentUnit instances (immutable).
 * Full TypeScript inference through all operations.
 */
export class AgentUnit<T> {
  /** Protected constructor — use static factory methods. */
  protected constructor(
    protected readonly computation: AgentComputation<T>,
    protected readonly _metadata: AgentUnitMetadata,
  ) {}

  // ─── INTERNAL API ────────────────────────────────────────────────────────────

  /**
   * @internal ID generator exposed for operator files (prototype augmentation).
   * Public so operator files can call it via the prototype-augmentation pattern.
   * Do NOT use from user code.
   */
  static readonly _generateId = generateId;

  /** True once the legacy-mode deprecation warning has been emitted (process-scoped). */
  static #deprecationWarned = false;

  /**
   * Returns and mutates the process-scoped deprecation flag.
   * Called by {@link zeroTrust.emitDeprecationWarning} only.
   * @internal
   */
  static _getAndSetDeprecationWarned(): boolean {
    const prev = AgentUnit.#deprecationWarned;
    AgentUnit.#deprecationWarned = true;
    return prev;
  }

  /**
   * Reset the deprecation warning flag. FOR TESTING ONLY.
   * Call in `beforeEach` to prevent state leaking between test cases.
   * @internal
   */
  static resetDeprecationWarningForTesting(): void {
    AgentUnit.#deprecationWarned = false;
  }

  /**
   * @internal Internal factory for creating instances from operator files (prototype augmentation).
   * Public so operator files can call it via the prototype-augmentation pattern.
   * Do NOT use from user code.
   */
  static _make<T>(
    computation: AgentComputation<T>,
    metadata: AgentUnitMetadata,
  ): AgentUnit<T> {
    return new AgentUnit<T>(computation, metadata);
  }

  // ─── CREATION METHODS ───────────────────────────────────────────────────────

  /**
   * Create an AgentUnit containing a pure value (the monadic `return`/`pure`).
   *
   * @param value - Any value to lift into the AgentUnit context.
   * @returns A new AgentUnit that resolves immediately with `value`.
   *
   * @example
   * ```typescript
   * const unit = AgentUnit.of("hello");
   * const result = await unit.run(ctx);
   * // result.value === "hello"
   * ```
   */
  static of<T>(value: T): AgentUnit<T> {
    return new AgentUnit<T>(() => Promise.resolve(value), {
      id: generateId(),
      operatorChain: ["of"],
      createdAt: Date.now(),
    });
  }

  /**
   * Create an AgentUnit from an async computation function.
   *
   * @param computation - An async function `(ctx: AgentContext) => Promise<T>`.
   * @returns A new AgentUnit wrapping the computation (lazy — not called until `.run()`).
   *
   * @example
   * ```typescript
   * const unit = AgentUnit.from(async (ctx) => {
   *   return await myAI.generate(ctx, "Summarize this document");
   * });
   * const result = await unit.run(ctx);
   * ```
   */
  static from<T>(computation: AgentComputation<T>): AgentUnit<T> {
    return new AgentUnit<T>(computation, {
      id: generateId(),
      operatorChain: ["from"],
      createdAt: Date.now(),
    });
  }

  /**
   * Create an AgentUnit from an already-created Promise.
   *
   * @param promise - A Promise that resolves to the desired value.
   * @returns A new AgentUnit wrapping the promise.
   *
   * @example
   * ```typescript
   * import { AgentUnit, createContext } from "@symplek/core";
   *
   * const ctx = createContext();
   * const unit = AgentUnit.fromPromise(fetch("https://api.example.com/data").then(r => r.text()));
   * const result = await unit.run(ctx);
   * console.log(result.value);
   * ```
   */
  static fromPromise<T>(promise: Promise<T>): AgentUnit<T> {
    return new AgentUnit<T>(async () => promise, {
      id: generateId(),
      operatorChain: ["fromPromise"],
      createdAt: Date.now(),
    });
  }

  /**
   * Create an AgentUnit that tries a primary computation and falls back to a
   * secondary function on failure. Replaces the manual try/catch inside AgentUnit.from().
   *
   * @param primary - Async function to try first
   * @param fallbackFn - Called with the thrown error when primary fails; return the fallback value
   *
   * @example
   * ```typescript
   * // INSTEAD OF (manual try/catch — 12 lines):
   * AgentUnit.from(async () => {
   *   try {
   *     const response = await generateText({model, prompt});
   *     return parseResponse(response.text);
   *   } catch (error) {
   *     console.warn("AI failed:", error);
   *     return fallbackResult();
   *   }
   * });
   *
   * // USE THIS (3 lines):
   * AgentUnit.fromWithFallback(
   *   async () => generateText({model, prompt}).then(r => parseResponse(r.text)),
   *   (error) => fallbackResult(),
   * )
   * ```
   */
  static fromWithFallback<T>(
    primary: () => Promise<T>,
    fallbackFn: (error?: Error) => T | Promise<T>,
  ): AgentUnit<T> {
    return new AgentUnit<T>(
      async (_ctx) => {
        try {
          return await primary();
        } catch (err) {
          return fallbackFn(
            err instanceof Error ? err : new Error(String(err)),
          );
        }
      },
      {
        id: generateId(),
        operatorChain: ["fromWithFallback"],
        createdAt: Date.now(),
      },
    );
  }

  /**
   * Create an AgentUnit that always fails with the given error.
   * Useful for representing known-bad states in a composition chain.
   *
   * @param error - The error to reject with when `.run()` is called.
   * @returns A new AgentUnit that always rejects.
   *
   * @example
   * ```typescript
   * import { AgentUnit, createContext } from "@symplek/core";
   *
   * const ctx = createContext();
   * const unit = AgentUnit.fail<string>(new Error("Not available"))
   *   .orElse("default value");
   * const result = await unit.run(ctx);
   * // result.value === "default value"
   * ```
   */
  static fail<T>(error: Error): AgentUnit<T> {
    return new AgentUnit<T>(() => Promise.reject(error), {
      id: generateId(),
      operatorChain: ["fail"],
      createdAt: Date.now(),
    });
  }

  // ─── TRANSFORMATION METHODS ──────────────────────────────────────────────────

  /**
   * Transform the resolved value with a pure function (functor `fmap`).
   *
   * @param f - A synchronous or async transformation function.
   * @returns A new AgentUnit whose resolved value is `f(original)`.
   *
   * @example
   * ```typescript
   * const unit = AgentUnit.of(42).map((n) => n * 2);
   * const result = await unit.run(ctx);
   * // result.value === 84
   * ```
   */
  map<U>(f: (value: T) => U): AgentUnit<U> {
    return new AgentUnit<U>(
      async (ctx) => {
        const value = await this.computation(ctx);
        return f(value);
      },
      {
        id: generateId(),
        operatorChain: [...this._metadata.operatorChain, "map"],
        createdAt: Date.now(),
      },
    );
  }

  /**
   * Monadic bind: chain a computation that depends on the current result.
   *
   * @param f - A function that receives the current value and returns a new AgentUnit.
   * @returns A new AgentUnit representing the sequential composition.
   *
   * @example
   * ```typescript
   * const pipeline = AgentUnit.of("raw text")
   *   .flatMap((text) => AgentUnit.from(async (ctx) => summarize(ctx, text)));
   * const result = await pipeline.run(ctx);
   * ```
   */
  flatMap<U>(f: (value: T) => AgentUnit<U>): AgentUnit<U> {
    return new AgentUnit<U>(
      async (ctx) => {
        const value = await this.computation(ctx);
        const nextUnit = f(value);
        return (
          nextUnit as unknown as { computation: AgentComputation<U> }
        ).computation(ctx);
      },
      {
        id: generateId(),
        operatorChain: [...this._metadata.operatorChain, "flatMap"],
        createdAt: Date.now(),
      },
    );
  }

  /**
   * Alias for {@link flatMap}. Chain a computation that depends on the current result.
   *
   * @param f - A function that receives the current value and returns a new AgentUnit.
   * @returns A new AgentUnit representing the sequential composition.
   *
   * @example
   * ```typescript
   * import { AgentUnit, createContext } from "@symplek/core";
   *
   * const ctx = createContext();
   * const result = await AgentUnit.of("input")
   *   .chain((text) => AgentUnit.from(async () => text.toUpperCase()))
   *   .run(ctx);
   * // result.value === "INPUT"
   * ```
   */
  chain<U>(f: (value: T) => AgentUnit<U>): AgentUnit<U> {
    return this.flatMap(f);
  }

  /**
   * Execute a side effect without changing the resolved value (observe without transform).
   * Useful for logging, metrics, or updating external state mid-chain.
   *
   * @param f - A function to call with the value; its return value is ignored.
   * @returns A new AgentUnit that resolves with the same value as the original.
   *
   * @example
   * ```typescript
   * import { AgentUnit, createContext } from "@symplek/core";
   *
   * const ctx = createContext();
   * const result = await AgentUnit.of("hello")
   *   .tap((v) => console.log("[debug] value:", v))
   *   .map((v) => v.toUpperCase())
   *   .run(ctx);
   * // console prints "[debug] value: hello"
   * // result.value === "HELLO"
   * ```
   */
  tap(f: (value: T) => void | Promise<void>): AgentUnit<T> {
    return new AgentUnit<T>(
      async (ctx) => {
        const value = await this.computation(ctx);
        await f(value);
        return value;
      },
      {
        id: generateId(),
        operatorChain: [...this._metadata.operatorChain, "tap"],
        createdAt: Date.now(),
      },
    );
  }

  // ─── STATIC PARALLEL METHODS ─────────────────────────────────────────────────

  /**
   * Run multiple AgentUnits in parallel and collect all results.
   * Equivalent to `Promise.all` but for AgentUnit compositions.
   *
   * @param units - Array of AgentUnits to execute concurrently.
   * @returns A new AgentUnit that resolves with an array of all results in input order.
   *
   * @example
   * ```typescript
   * const [a, b] = await AgentUnit.zipAll([
   *   AgentUnit.from(async (ctx) => fetchData(ctx, "endpoint-a")),
   *   AgentUnit.from(async (ctx) => fetchData(ctx, "endpoint-b")),
   * ]).run(ctx).then((r) => r.value);
   * ```
   */
  static zipAll<U>(units: AgentUnit<U>[]): AgentUnit<U[]> {
    return new AgentUnit<U[]>(
      async (ctx) => {
        return Promise.all(
          units.map((u) =>
            (u as unknown as { computation: AgentComputation<U> }).computation(
              ctx,
            ),
          ),
        );
      },
      {
        id: generateId(),
        operatorChain: ["zipAll"],
        isParallel: true,
        createdAt: Date.now(),
      },
    );
  }

  /**
   * Race multiple AgentUnits, returning the value of the first to complete.
   * Equivalent to `Promise.race` but for AgentUnit compositions.
   *
   * @param units - Array of AgentUnits to race concurrently.
   * @returns A new AgentUnit that resolves with the first result to complete.
   *
   * @example
   * ```typescript
   * import { AgentUnit, createContext } from "@symplek/core";
   *
   * const ctx = createContext();
   * const result = await AgentUnit.race([
   *   AgentUnit.from(async () => { await delay(100); return "slow"; }),
   *   AgentUnit.from(async () => { await delay(10);  return "fast"; }),
   * ]).run(ctx);
   * // result.value === "fast"
   * ```
   */
  static race<U>(units: AgentUnit<U>[]): AgentUnit<U> {
    if (units.length === 0) {
      return AgentUnit.fail<U>(
        new Error("race() requires at least one unit; received an empty array"),
      );
    }
    return new AgentUnit<U>(
      async (ctx) => {
        return Promise.race(
          units.map((u) =>
            (u as unknown as { computation: AgentComputation<U> }).computation(
              ctx,
            ),
          ),
        );
      },
      {
        id: generateId(),
        operatorChain: ["race"],
        isParallel: true,
        createdAt: Date.now(),
      },
    );
  }

  /**
   * Architecture note — Option A (future work):
   * Moving all operator methods into the class body would eliminate the need for
   * prototype augmentation entirely, making internal imports safe. This is a multi-day
   * refactor deferred to avoid breaking the current operator extension pattern.
   * See: packages/symplek-core/src/AgentUnit/operators/index.ts
   */

  // ─── EXECUTION ────────────────────────────────────────────────────────────────

  /**
   * Execute the AgentUnit computation with the given context.
   *
   * In zero-trust mode (default), the result is wrapped in a `TrackedResult<T>`
   * that includes provenance metadata. In legacy mode, the raw value is returned.
   *
   * @param ctx - The AgentContext providing model, memory, and tool access.
   * @param options - Optional execution options (`trustMode`, `captureIntermediates`).
   * @returns A `TrackedResult<T>` (zero-trust) or raw `T` (legacy mode).
   *
   * @example
   * ```typescript
   * const unit = AgentUnit.of("hello");
   * const tracked = await unit.run(ctx);
   * console.log(tracked.value);      // "hello"
   * console.log(tracked.source);     // "agent"
   * console.log(tracked.confidence); // 0.85 (base) — adjusts per operator chain
   * ```
   */
  async run(ctx: import("../types").AgentContext): Promise<TrackedResult<T>>;
  async run(
    ctx: import("../types").AgentContext,
    options: Omit<RunOptionsWithTrust, "trustMode"> & {
      trustMode?: "zero-trust";
    },
  ): Promise<TrackedResult<T>>;
  /**
   * @deprecated trustMode: 'legacy' will be removed in v3.0. Use the default
   *   zero-trust mode instead.
   */
  async run(
    ctx: import("../types").AgentContext,
    options: Omit<RunOptionsWithTrust, "trustMode"> & { trustMode: "legacy" },
  ): Promise<T>;
  async run(
    ctx: import("../types").AgentContext,
    options?: RunOptionsWithTrust,
  ): Promise<TrackedResult<T> | T> {
    // Runtime guard: detect missing prototype augmentation (import from internal path)
    if (typeof (this as any).retry !== "function") {
      throw new SymplekError({
        code: "SETUP_ERROR",
        message:
          'AgentUnit operators not loaded. Import from "@symplek/core", not internal paths.',
        action: 'Change import to: import { AgentUnit } from "@symplek/core";',
      });
    }
    const trustMode: TrustMode = options?.trustMode ?? "zero-trust";

    // ─── Idempotency pre-check (before execution) ──────────────────────────
    // Resolved here so a `reject` throw propagates cleanly, ahead of the
    // try/catch that would otherwise re-route it through handleError().
    //
    // B3 FIX (revised): in-flight registration happens synchronously BEFORE any
    // await. Previous ordering checked the persistent store first (async), then
    // checked the in-flight map. That allowed a concurrent caller whose store-get
    // was still pending to miss the flight entry entirely and re-execute after the
    // winner's store-write failed. New ordering:
    //   1. Check in-flight map (synchronous) — no await, so registration is
    //      visible to every JS-concurrent caller before we yield.
    //   2. If in-flight: await the winning promise (same result, no re-execution).
    //   3. If not in-flight: register then execute; persistent-store check moves
    //      inside the promise so it is also covered by the in-flight guard.
    const idempotency = options?.idempotency;
    let idemStore: IdempotencyStore | null = null;
    let runCtx = ctx;
    if (idempotency) {
      idemStore = idempotency.store ?? defaultIdempotencyStore;
      runCtx = { ...ctx, idempotencyKey: idempotency.key };

      // ── Step 1: check in-flight map synchronously ──────────────────────────
      // Must happen before any await so no concurrent caller can slip past
      // registration. The flight key is scoped to store identity + logical key —
      // exactly the scope at which persistence is keyed — so two independently
      // constructed units sharing the same store and key share the same flight slot
      // and execute the computation exactly once.
      const flightKey = buildFlightKey(idemStore, idempotency.key);
      const inFlight = _idempotencyInFlight.get(flightKey);
      if (inFlight !== undefined) {
        // A concurrent run is already executing for this key. Await its settled
        // promise — this covers both success and store-write failure, ensuring
        // the caller never silently re-executes after the winner fails to persist.
        //
        // Each caller applies its OWN strategy after the shared promise settles.
        // The leader's strategy must not govern waiters: a "return-cached" waiter
        // must not inherit a "reject" leader's IdempotencyError, and vice versa.
        let inflightResult: TrackedResult<T>;
        try {
          inflightResult = (await inFlight) as TrackedResult<T>;
        } catch (err) {
          // The leader rejected with IdempotencyError: it found the key in the
          // store and its own strategy was "reject". Apply THIS caller's strategy.
          if (err instanceof IdempotencyError) {
            if (idempotency.strategy === "reject") {
              throw new IdempotencyError(idempotency.key);
            }
            // "return-cached": key is confirmed in the store — fetch and return.
            const storeResult = await idemStore!.get(idempotency.key);
            if (storeResult !== null) {
              if (!isTrackedResult<T>(storeResult)) {
                throw new SymplekError({
                  code: "SETUP_ERROR",
                  why:
                    "Cached idempotency result is not a genuine TrackedResult — " +
                    "the idempotency store may be compromised.",
                  action: `Clear the cache for key "${idempotency.key}" and re-run.`,
                });
              }
              if (trustMode === "legacy") {
                emitDeprecationWarning(AgentUnit);
                return storeResult.value;
              }
              return storeResult as TrackedResult<T>;
            }
          }
          throw err;
        }
        // In-flight settled successfully; apply THIS caller's own strategy.
        if (idempotency.strategy === "reject") {
          throw new IdempotencyError(idempotency.key);
        }
        if (trustMode === "legacy") {
          emitDeprecationWarning(AgentUnit);
          return inflightResult.value;
        }
        return inflightResult;
      }

      // ── Step 2: execute with in-flight tracking ───────────────────────────
      // The async IIFE runs synchronously until its first `await` (idemStore.get).
      // Registering the flight entry immediately after starting the IIFE ensures
      // the entry is visible to any concurrent caller before we yield — no other
      // JS code runs between the IIFE start and the .set() call below.
      //
      // Contract: IdempotencyStore.get() MUST NOT call run() for the same key
      // (see IdempotencyStore JSDoc). A re-entrant get() would find an empty
      // flight map and execute the computation a second time. Implement stores
      // as pure read-through to external state only.
      const executionPromise = (async (): Promise<TrackedResult<T>> => {
        // ── Step 2a: check persistent store ──────────────────────────────────
        const cached = await idemStore!.get(idempotency.key);
        if (cached !== null) {
          if (idempotency.strategy === "reject") {
            throw new IdempotencyError(idempotency.key);
          }
          // ⚠️ FATAL #3 HARDENING: Verify cached value is a genuine TrackedResult
          // before returning it. A malicious or shared store could inject arbitrary
          // objects.
          if (!isTrackedResult<T>(cached)) {
            throw new SymplekError({
              code: "SETUP_ERROR",
              why:
                "Cached idempotency result is not a genuine TrackedResult — " +
                "the idempotency store may be compromised.",
              action: `Clear the cache for key "${idempotency.key}" and re-run.`,
            });
          }
          return cached;
        }

        // ── Step 2b: execute computation ─────────────────────────────────────
        const value = await this.computation(runCtx);
        const tracked = wrapInTrackedResult(this._metadata, value);

        // ── Step 2c: write to persistent store ───────────────────────────────
        // If the store write fails, surface it as IdempotencyStoreWriteError so
        // callers know the computation succeeded but the key was not persisted.
        // Any concurrent caller awaiting this promise receives the same error and
        // does NOT re-execute.
        try {
          await idemStore!.set(idempotency.key, tracked, idempotency.ttl);
        } catch (storeErr) {
          throw new IdempotencyStoreWriteError(idempotency.key, storeErr, tracked);
        }
        return tracked;
      })();

      // Register AFTER starting the IIFE. Runs synchronously before any awaited
      // code in the IIFE can yield control to another caller.
      _idempotencyInFlight.set(
        flightKey,
        executionPromise as Promise<TrackedResult<unknown>>,
      );

      try {
        const tracked = await executionPromise;
        if (trustMode === "legacy") {
          emitDeprecationWarning(AgentUnit);
          return tracked.value;
        }
        return tracked;
      } catch (error) {
        if (error instanceof Error) {
          handleError(error, this._metadata.operatorChain);
        }
        handleError(new Error(String(error)), this._metadata.operatorChain);
      } finally {
        _idempotencyInFlight.delete(flightKey);
      }
    }

    try {
      const value = await this.computation(runCtx);
      if (trustMode === "legacy") {
        emitDeprecationWarning(AgentUnit);
        return value;
      }
      return wrapInTrackedResult(this._metadata, value);
    } catch (error) {
      if (error instanceof Error) {
        handleError(error, this._metadata.operatorChain);
      }
      handleError(new Error(String(error)), this._metadata.operatorChain);
    }
  }

  // ─── METADATA ────────────────────────────────────────────────────────────────

  /**
   * Get a snapshot of the metadata attached to this AgentUnit.
   * Includes the operator chain history, creation timestamp, and unique ID.
   * Useful for debugging and observability.
   *
   * @returns A shallow copy of the {@link AgentUnitMetadata} for this instance.
   *
   * @example
   * ```typescript
   * import { AgentUnit } from "@symplek/core";
   *
   * const unit = AgentUnit.of("hello").map((s) => s.toUpperCase()).retry(2);
   * const meta = unit.getMetadata();
   * console.log(meta.operatorChain); // ["of", "map", "retry"]
   * ```
   */
  getMetadata(): AgentUnitMetadata {
    return { ...this._metadata };
  }
}

// ─── OPERATOR INTERFACE MERGING ─────────────────────────────────────────────
//
// Method signatures for every operator attached via prototype augmentation in
// ./operators/*.ts. Declaration merging with the class above gives consumers a
// fully-typed surface AND keeps the runtime augmentation pattern. Implementations
// live in the operator files (which assign to `AgentUnit.prototype`).
//
// This single same-file `interface AgentUnit<T>` is reliable across dts bundlers
// (tsup, rollup-plugin-dts, api-extractor); the older `declare module
// "../AgentUnit"` pattern from operators/*.ts gets dropped during dts rollup
// because the relative module specifier no longer resolves post-bundle.

export interface AgentUnit<T> {
  // ─── resilience ──────────────────────────────────────────────────────────
  /** Provide a fallback AgentUnit to execute if this one fails. */
  fallback(other: AgentUnit<T>): AgentUnit<T>;
  /** Provide a static default value if this unit fails. */
  orElse(defaultValue: T): AgentUnit<T>;
  /** Retry this unit on failure with exponential backoff. */
  retry(maxAttempts?: number, options?: RetryOptions): AgentUnit<T>;
  /** Add a deadline to this unit's execution. */
  timeout(timeoutMs: number, message?: string): AgentUnit<T>;

  // ─── tracking ────────────────────────────────────────────────────────────
  /** Wrap the resolved value in a TrackedResult with provenance metadata. */
  tracked(options: SourceTrackingOptions): AgentUnit<TrackedResult<T>>;

  // ─── transform ───────────────────────────────────────────────────────────
  /** Conditionally route to one of two AgentUnits based on a predicate. */
  branch<U>(
    pred: (value: T) => boolean,
    ifTrue: (value: T) => AgentUnit<U>,
    ifFalse: (value: T) => AgentUnit<U>,
  ): AgentUnit<U>;

  // ─── model ───────────────────────────────────────────────────────────────
  /** Override the AI model for this computation step. */
  model(name: string): AgentUnit<T>;
  /** Set quality hint for this computation step. */
  quality(level: "high" | "fast"): AgentUnit<T>;

  // ─── parallel ────────────────────────────────────────────────────────────
  /** Run this unit and another in parallel, returning both results as a tuple. */
  zip<U>(other: AgentUnit<U>): AgentUnit<[T, U]>;

  // ─── coordination ────────────────────────────────────────────────────────
  /**
   * Run single-round consensus voting over the current value.
   *
   * @remarks
   * **Promise voter cancellation**: voters that return a bare `Promise` cannot
   * receive an abort signal. When `ConsensusOptions.timeout` fires or the
   * upstream context is cancelled, the wait is abandoned but the underlying
   * operation keeps running. If the voter's work must be cancellable, return
   * an `AgentUnit` instead — the `AgentContext.signal` is then propagated and
   * LLM calls are cancelled when the timeout fires.
   */
  consensus(
    voters: Array<
      (proposal: T) => AgentUnit<VoteInput> | Promise<VoteInput> | VoteInput
    >,
    options?: ConsensusOptions,
  ): AgentUnit<ConsensusResult>;
  /** Run iterative convergence across multiple rounds. */
  converge(
    agents: Array<ConvergentAgent<T>>,
    options?: ConvergeOptions,
  ): AgentUnit<ConvergeResult<T>>;
  /** Run debate coordination: sequential refinement followed by unanimous consensus. */
  debate(
    agents: Array<DebateAgent<T>>,
    options?: DebateOptions,
  ): AgentUnit<DebateResult<T>>;
  /** Run dialectic coordination: leader synthesises advisor input. */
  dialectic(
    leader: LeaderAgent<T>,
    advisors: Array<AdvisorAgent<T>>,
    options?: DialecticOptions,
  ): AgentUnit<DialecticResult<T>>;
  /** Check coherence of a multi-agent result. Chain after consensus/debate/dialectic. */
  coherence(
    this: AgentUnit<T & HasVotes>,
    options?: CoherenceOptions,
  ): AgentUnit<CoherenceResult<T & HasVotes>>;
  /** Execute autonomously when confidence and coherence are high. */
  solo(config?: SoloConfig): AgentUnit<SoloResult<T>>;

  // ─── reflection ───────────────────────────────────────────────────────────
  /** Recursive self-review: critique, verify, and optionally improve output. */
  reflect(options?: ReflectOptions<T>): AgentUnit<ReflectResult<T>>;

  // ─── interview ───────────────────────────────────────────────────────────
  /** Configure an adaptive human-in-the-loop interview. */
  interview<TContext>(
    config: InterviewConfig<TContext>,
  ): AgentUnit<InterviewPending<TContext>>;
  /** Execute a pending interview by activating question delivery. */
  conduct<TContext>(
    this: AgentUnit<InterviewPending<TContext>>,
    handlers: InterviewHandlers,
  ): AgentUnit<InterviewResult<TContext>>;

  // ─── rehearsal ───────────────────────────────────────────────────────────
  /** Record an execution trace for later deterministic replay. */
  rehearse(options?: RecorderOptions): AgentUnit<RehearsalResult<T>>;
  /** Replay a previously recorded ExecutionTrace deterministically. */
  replay(
    trace: ExecutionTrace<T>,
    options?: ReplayerOptions,
  ): AgentUnit<ReplayResult<T>>;

  // ─── contracts ───────────────────────────────────────────────────────────
  /** Declare the output contract for this unit (Zod schema). */
  provides<TSchema extends z.ZodType>(
    schema: TSchema,
    options?: ContractOptions,
  ): AgentUnit<z.infer<TSchema>>;
  /** Declare the input contract for this unit (Zod schema). */
  expects<TSchema extends z.ZodType>(
    schema: TSchema,
    inputSelector: (ctx: AgentContext) => unknown,
  ): AgentUnit<T>;

  // ─── compensate ──────────────────────────────────────────────────────────
  /** Attach a compensation (rollback) function that runs when this unit fails. */
  compensate(compensateFn: CompensateFn): AgentUnit<T>;

  // ─── saga ────────────────────────────────────────────────────────────────
  /** Execute a multi-step saga with execute/undo pairs. */
  saga(steps: SagaStep<unknown>[]): AgentUnit<unknown[]>;

  // ─── supervised ──────────────────────────────────────────────────────────
  /** Add a human-in-the-loop checkpoint to this unit's output. */
  supervised(
    predicateFn: (value: T) => boolean,
    reviewFn: (value: T) => Promise<SupervisedDecision<T>>,
    options?: SupervisedOptions<T>,
  ): AgentUnit<T>;

  // ─── runStandalone ───────────────────────────────────────────────────────
  /** Execute without a pre-created AgentContext. */
  runStandalone(): Promise<TrackedResult<T>>;
  runStandalone(options: {
    trustMode?: "zero-trust";
  }): Promise<TrackedResult<T>>;
  runStandalone(options: { trustMode: "legacy" }): Promise<T>;
}
