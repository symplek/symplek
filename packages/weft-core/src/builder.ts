/**
 * @module builder - WeftBuilder class and WeftOptions type
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

export interface WeftOptions<T = unknown> {
  /** Zod schema for output validation and type inference. */
  schema?: z.ZodType<T>;
  /**
   * Confidence score attached to the TrackedResult wrapper.
   * @default 0.85
   */
  confidence?: number;
  /** Execution timeout in milliseconds. */
  timeout?: number;
  /** Model override for this specific call. */
  model?: string;
  /** Retry configuration for failed operations. */
  retry?: RetryOptions | number;
}

// ─────────────────────────────────────────────────────────────────────────────
// BUILDER
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Lazy builder wrapping real AI execution via ai().
 *
 * - `await Weft("task")` runs the prompt through the provider pipeline.
 * - `Weft("task").coordinate()` bridges into the full AgentUnit algebra,
 *   so coordination operators like `.consensus()`, `.debate()`, and
 *   `.dialectic()` compose directly onto a facade call.
 * - `Weft("task").toUnit()` is an alias for `.coordinate()`.
 *
 * @example
 * ```typescript
 * // Simple call
 * const result = await Weft("Summarise this");
 *
 * // Bridge to multi-agent coordination
 * const consensus = await Weft("Analyse this clause")
 *   .coordinate()
 *   .consensus([legal, contractor, mediator])
 *   .run(ctx);
 * ```
 */
export class WeftBuilder<T = unknown> implements PromiseLike<TrackedResult<T>> {
  private readonly task: string;
  private readonly options: WeftOptions<T>;
  private _unit: AgentUnit<T> | null = null;

  constructor(task: string, options?: WeftOptions<T>) {
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
    return this.coordinate().run(ctx);
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

    if (opts.schema) {
      // Schema provided: ai() returns the parsed output type.
      // We narrow through opts.schema to preserve the Zod inference chain.
      const schema = opts.schema;
      const unit = AgentUnit.from<T>(async () => {
        const result = await ai(task, {
          model: opts.model,
          schema,
        });
        return result as T;
      });
      return unit.provides(schema) as AgentUnit<T>;
    }

    // No schema: ai() returns string. We cast through unknown to prevent
    // leaking unknown/any through the type system — callers of WeftBuilder<string>
    // get a properly typed string result.
    const unit = AgentUnit.from<T>(async () => {
      const result = await ai(task, {
        model: opts.model,
      });
      return result as unknown as T;
    });

    if (opts.timeout !== undefined) {
      return unit.timeout(opts.timeout) as unknown as AgentUnit<T>;
    }
    if (opts.retry !== undefined) {
      const retryConfig =
        typeof opts.retry === "number"
          ? { maxAttempts: opts.retry }
          : opts.retry;
      return unit
        .retry(retryConfig.maxAttempts ?? 3, retryConfig)
        .timeout(opts.timeout ?? 30_000) as unknown as AgentUnit<T>;
    }

    return unit;
  }
}
