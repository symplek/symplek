/**
 * @module builder - SymplekBuilder class and SymplekOptions type
 * @description Lazy promise-like builder that defers AI execution until awaited.
 *   Extracted from facade.ts to break the facade ↔ agent circular dependency.
 * @rules @.cursor/rules/patterns/029-file-header-contracts.mdc
 * @runtime node
 * @surface server:internal
 */

import type { z } from "zod";
import { AgentUnit } from "./AgentUnit";
import { ai } from "./ai";
import { createContext } from "./context";
import type { RetryOptions, TrackedResult } from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

export interface SymplekOptions<T = unknown> {
  /** Zod schema for output validation and type inference. */
  schema?: z.ZodType<T>;
  /**
   * Confidence score to attach to the returned TrackedResult.
   * When set, overrides the confidence computed from the operator chain.
   * @default 0.85
   */
  confidence?: number;
  /** Execution timeout in milliseconds. Applies to both schema and non-schema paths. */
  timeout?: number;
  /** Model override for this specific call. */
  model?: string;
  /** Retry configuration for failed operations. Applies to both schema and non-schema paths. */
  retry?: RetryOptions | number;
  /** Provider override for this specific call (e.g. "openai", "anthropic"). */
  provider?: string;
  /** System prompt prepended to the request. */
  system?: string;
  /** Sampling temperature (0-2). */
  temperature?: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// BUILDER
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Lazy builder wrapping real AI execution via ai().
 *
 * - `await Symplek("task")` runs the prompt through the provider pipeline.
 * - `Symplek("task").coordinate()` bridges into the full AgentUnit algebra,
 *   so coordination operators like `.consensus()`, `.debate()`, and
 *   `.dialectic()` compose directly onto a facade call.
 * - `Symplek("task").toUnit()` is an alias for `.coordinate()`.
 *
 * @example
 * ```typescript
 * // Simple call
 * const result = await Symplek("Summarise this");
 *
 * // Bridge to multi-agent coordination
 * const consensus = await Symplek("Analyse this clause")
 *   .coordinate()
 *   .consensus([legal, contractor, mediator])
 *   .run(ctx);
 * ```
 */
export class SymplekBuilder<T = unknown> implements PromiseLike<TrackedResult<T>> {
  private readonly task: string;
  private readonly options: SymplekOptions<T>;
  private _unit: AgentUnit<T> | null = null;

  constructor(task: string, options?: SymplekOptions<T>) {
    this.task = task;
    this.options = options ?? {};
  }

  /**
   * Bridge into the full AgentUnit coordination algebra.
   * Returns an AgentUnit backed by real AI execution, ready for
   * `.consensus()`, `.debate()`, `.dialectic()`, and all other operators.
   */
  coordinate(): AgentUnit<T> {
    if (this._unit === null) {
      this._unit = this.buildUnit();
    }
    return this._unit;
  }

  /**
   * Alias for `.coordinate()`.
   * @deprecated Prefer `.coordinate()` for clarity. Will be removed in v2.
   */
  toUnit(): AgentUnit<T> {
    return this.coordinate();
  }

  /** Execute the underlying AgentUnit and return its tracked result. */
  async run(): Promise<TrackedResult<T>> {
    const ctx = createContext();
    const result = await this.coordinate().run(ctx);
    // N51 fix: apply the user-specified confidence to the result.
    // Previously, SymplekOptions.confidence was accepted but silently ignored;
    // the confidence was always recomputed from the operator chain.
    if (this.options.confidence !== undefined) {
      result.confidence = this.options.confidence;
    }
    return result;
  }

  then<TResult1 = TrackedResult<T>, TResult2 = never>(
    onfulfilled?:
      | ((value: TrackedResult<T>) => TResult1 | PromiseLike<TResult1>)
      | null
      | undefined,
    onrejected?:
      | ((reason: unknown) => TResult2 | PromiseLike<TResult2>)
      | null
      | undefined,
  ): Promise<TResult1 | TResult2> {
    return this.run().then(onfulfilled, onrejected);
  }

  private buildUnit(): AgentUnit<T> {
    const task = this.task;
    const opts = this.options;

    // N50 fix: forward all AgentConfig fields to ai() — provider, system, and
    // temperature were previously accepted in SymplekOptions but silently dropped.
    const aiOpts = {
      model: opts.model,
      provider: opts.provider,
      system: opts.system,
      temperature: opts.temperature,
    };

    let unit: AgentUnit<T>;

    if (opts.schema) {
      // Schema provided: ai() returns the parsed output type.
      // We narrow through opts.schema to preserve the Zod inference chain.
      const schema = opts.schema;
      const base = AgentUnit.from<T>(async () => {
        const result = await ai(task, { ...aiOpts, schema });
        return result as T;
      });
      unit = base.provides(schema) as AgentUnit<T>;
    } else {
      // No schema: ai() returns string. We cast through unknown to prevent
      // leaking unknown/any through the type system.
      unit = AgentUnit.from<T>(async () => {
        const result = await ai(task, aiOpts);
        return result as unknown as T;
      });
    }

    // N41 fix: apply resilience wrappers to BOTH schema and non-schema paths.
    // Previously the schema branch applied neither, and the non-schema branch
    // dropped retry when timeout was also set (if/else-if ordering bug).
    //
    // Order: timeout first (per-attempt bound), then retry wraps the timed unit
    // so each attempt independently gets a fresh timeout window.
    if (opts.timeout !== undefined) {
      unit = unit.timeout(opts.timeout) as unknown as AgentUnit<T>;
    }
    if (opts.retry !== undefined) {
      const retryConfig =
        typeof opts.retry === "number"
          ? { maxAttempts: opts.retry }
          : opts.retry;
      unit = unit.retry(
        retryConfig.maxAttempts ?? 3,
        retryConfig,
      ) as unknown as AgentUnit<T>;
    }

    return unit;
  }
}
