/**
 * @module weft-core/operators/fallback
 * @description Fallback operator: falls back to an alternative computation when primary fails.
 * @blast_radius LOW
 * @status STABLE
 */

import type { AgentComputation, AgentUnitMetadata } from "../AgentUnit";
import type { AgentContext } from "../types";

/**
 * Creates a computation that falls back to another if the first fails.
 */
export function createFallbackComputation<T>(
  primaryComputation: AgentComputation<T>,
  fallbackComputation: AgentComputation<T>,
  _primaryMeta: AgentUnitMetadata,
  _fallbackMeta: AgentUnitMetadata,
): AgentComputation<T> {
  return async (ctx: AgentContext): Promise<T> => {
    try {
      return await primaryComputation(ctx);
    } catch (_error) {
      // Primary failed, try fallback
      return fallbackComputation(ctx);
    }
  };
}
