/**
 * @module @symplek/core/operators/timeout
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
    let timerId: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timerId = setTimeout(() => {
        reject(
          new Error(message ?? `Operation timed out after ${timeoutMs}ms`),
        );
      }, timeoutMs);
    });

    try {
      return await Promise.race([innerComputation(ctx), timeoutPromise]);
    } finally {
      if (timerId !== undefined) {
        clearTimeout(timerId);
      }
    }
  };
}
