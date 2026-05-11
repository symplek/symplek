/**
 * @module AgentUnit/operators/saga
 * @description AgentUnit saga operator extension (.saga()).
 *   Implements the saga pattern with multi-step execute/undo pairs.
 *   Executes steps in order; on failure rolls back completed steps in LIFO
 *   order. Undo errors are suppressed — original error always propagates.
 * @rules @.cursor/rules/frameworks/206-weft-framework.mdc
 * @blast_radius HIGH - Part of the agent resilience safety layer
 * @status STABLE
 * @runtime node
 * @surface internal
 */

import type { AgentContext } from "../../types";
import type { AgentComputation } from "../AgentUnit";
import { AgentUnit } from "../AgentUnit";

// ─── PUBLIC TYPES ──────────────────────────────────────────────────────────────

/**
 * A single step in a saga: a forward `execute` function and a compensating `undo`.
 *
 * @typeParam T - The value produced by `execute` and received by `undo`.
 */
export interface SagaStep<T> {
  /** Forward action: runs and produces a result captured in the in-memory saga log. */
  execute: (ctx: AgentContext) => Promise<T>;
  /**
   * Compensating action: receives the context and the captured `execute` result.
   * Called only when a later step fails. Errors thrown here are suppressed.
   */
  undo: (ctx: AgentContext, result: T) => Promise<void>;
  /** Optional step name surfaced in diagnostics. */
  name?: string;
}

/**
 * Configuration object for the saga pattern (mirrors the `steps` array shape
 * for callers that prefer an options-bag style).
 */
export interface SagaConfig {
  steps: SagaStep<unknown>[];
}

// ─── MODULE AUGMENTATION ───────────────────────────────────────────────────────

// ─── PROTOTYPE AUGMENTATION ────────────────────────────────────────────────────

AgentUnit.prototype.saga = function <T>(
  this: AgentUnit<T>,
  steps: SagaStep<unknown>[],
): AgentUnit<unknown[]> {
  const selfMeta = this.getMetadata();

  return AgentUnit._make<unknown[]>(
    async (ctx: AgentContext) => {
      // In-memory saga log: completed {step, result} pairs in forward order
      const log: Array<{ step: SagaStep<unknown>; result: unknown }> = [];

      for (const step of steps) {
        try {
          const result = await step.execute(ctx);
          log.push({ step, result });
        } catch (err) {
          const originalError =
            err instanceof Error ? err : new Error(String(err));

          // Rollback completed steps in LIFO order
          for (let i = log.length - 1; i >= 0; i--) {
            const { step: completedStep, result: completedResult } = log[i]!;
            try {
              await completedStep.undo(ctx, completedResult);
            } catch {
              // Undo errors suppressed — original error always wins
            }
          }

          throw originalError;
        }
      }

      return log.map((entry) => entry.result);
    },
    {
      id: AgentUnit._generateId(),
      operatorChain: [...selfMeta.operatorChain, "saga"],
      createdAt: Date.now(),
    },
  );
};

// Silence unused-import warning — AgentComputation is re-exported for callers
// that need the bare computation type when composing saga steps.
export type { AgentComputation };
