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
        } catch {
          // Compensation errors are suppressed — original error always wins
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
