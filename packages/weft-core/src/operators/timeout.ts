/**
 * @module weft-core/operators/timeout
 * @description Timeout operator: cancels a computation after a specified duration.
 * @blast_radius LOW
 * @status STABLE
 */

import type { AgentComputation, AgentUnitMetadata } from "../AgentUnit";
import type { AgentContext } from "../types";

/**
 * Creates a computation that times out after a specified duration.
 */
export function createTimeoutComputation<T>(
  innerComputation: AgentComputation<T>,
  _innerMeta: AgentUnitMetadata,
  options: { timeoutMs: number; message?: string },
): AgentComputation<T> {
  const { timeoutMs, message } = options;

  return async (ctx: AgentContext): Promise<T> => {
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => {
        reject(
          new Error(message ?? `Operation timed out after ${timeoutMs}ms`),
        );
      }, timeoutMs);
    });

    return Promise.race([innerComputation(ctx), timeoutPromise]);
  };
}
