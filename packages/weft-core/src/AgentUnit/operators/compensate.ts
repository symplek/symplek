/**
 * @module AgentUnit/operators/compensate
 * @description AgentUnit compensate operator extension (.compensate()).
 *   Runs a compensation/rollback function when the primary action fails,
 *   then re-throws the original error. No-op on success.
 * @blast_radius HIGH - Part of the agent resilience safety layer
 * @status STABLE
 * @runtime node
 * @surface internal
 */

import { CompensationError } from "../../errors";
import type { AgentContext } from "../../types";
import type { AgentComputation } from "../AgentUnit";
import { AgentUnit } from "../AgentUnit";

/**
 * Callback type for compensation / rollback logic attached via `.compensate()`.
 *
 * @param context.error - The error thrown by the primary computation.
 * @param context.partialResult - Any partial result captured before failure (if available).
 * @param context.agentContext - The AgentContext passed to `.run()`.
 */
export type CompensateFn = (context: {
  error: Error;
  partialResult?: unknown;
  agentContext: AgentContext;
}) => Promise<void> | void;

AgentUnit.prototype.compensate = function <T>(
  this: AgentUnit<T>,
  compensateFn: CompensateFn,
): AgentUnit<T> {
  const selfComp = (this as unknown as { computation: AgentComputation<T> })
    .computation;
  const selfMeta = this.getMetadata();
  return AgentUnit._make<T>(
    async (ctx) => {
      try {
        return await selfComp(ctx);
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        try {
          await compensateFn({ error, agentContext: ctx });
        } catch (compErr) {
          // N68: Surface the compensation failure — silently discarding it
          // leaves partially-restored external state indistinguishable from
          // a clean rollback. Wrap both errors in CompensationError so the
          // caller sees what failed and can investigate state consistency.
          const compensationError =
            compErr instanceof Error ? compErr : new Error(String(compErr));
          throw new CompensationError(error, compensationError);
        }
        throw error;
      }
    },
    {
      id: AgentUnit._generateId(),
      operatorChain: [...selfMeta.operatorChain, "compensate"],
      createdAt: Date.now(),
    },
  );
};
