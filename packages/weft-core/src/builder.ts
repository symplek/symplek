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
 * - `await Weft("task")` — runs the prompt through the provider pipeline
 * - `Weft("task").toUnit()` — escape hatch to full AgentUnit composition
 */
export class WeftBuilder<T = unknown> implements PromiseLike<TrackedResult<T>> {
  private readonly task: string;
  private readonly options: WeftOptions<T>;
  private _unit: AgentUnit<T> | null = null;

  constructor(task: string, options?: WeftOptions<T>) {
    this.task = task;
    this.options = options ?? {};
  }

  /** Escape hatch — returns an AgentUnit backed by real AI execution. */
  toUnit(): AgentUnit<T> {
    if (this._unit === null) {
      this._unit = this.buildUnit();
    }
    return this._unit;
  }

  /** Execute the underlying AgentUnit and return its tracked result. */
  async run(): Promise<TrackedResult<T>> {
    const ctx = createContext();
    return this.toUnit().run(ctx);
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

    let unit = AgentUnit.from<T>(async () => {
      const result = await ai(task, {
        model: opts.model,
        schema: opts.schema,
      } as any);
      return result as T;
    });

    if (opts.schema) {
      unit = unit.provides(opts.schema);
    }
    if (opts.timeout !== undefined) {
      unit = unit.timeout(opts.timeout);
    }
    if (opts.retry !== undefined) {
      const retryConfig =
        typeof opts.retry === "number"
          ? { maxAttempts: opts.retry }
          : opts.retry;
      unit = unit.retry(retryConfig.maxAttempts ?? 3, retryConfig);
    }

    return unit;
  }
}
