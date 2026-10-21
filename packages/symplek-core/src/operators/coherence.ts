/**
 * @module @symplek/core/operators/coherence
 * @description Coherence operator: measures ensemble agreement and throws on low coherence.
 * @blast_radius MEDIUM - CoherenceError is part of the public error API
 * @status STABLE
 */

import type { AgentComputation, AgentUnitMetadata } from "../AgentUnit";
import { calculateCompositeCoherence } from "../coherence/calculations/compositeCoherence";
import { resolveThreshold } from "../coherence/config";
// Coherence imports (STORY-02.02)
import type { EnsembleCoherence, HasVotes } from "../coherence/types";
import { hasContributions, hasVotes } from "../coherence/types";
import type { AgentContext, CoherenceOptions, CoherenceResult } from "../types";

/**
 * Low coherence error with E304 code.
 *
 * @remarks
 * Thrown when `failOnLowCoherence: true` and coherence is below threshold.
 *
 * 📝 BUILD[STORY-02.04]: E304 error code for low coherence
 */
export class CoherenceError extends Error {
  readonly code = "E304";
  readonly coherence: EnsembleCoherence;
  readonly threshold: number;

  constructor(coherence: EnsembleCoherence, threshold: number) {
    super(
      `[E304] Coordination Error: Ensemble coherence ${coherence.composite.toFixed(4)} ` +
        `below threshold ${threshold.toFixed(4)}`,
    );
    this.name = "CoherenceError";
    this.coherence = coherence;
    this.threshold = threshold;
  }
}

/**
 * Creates a computation that calculates coherence for a multi-agent result.
 *
 * @remarks
 * This factory follows the established pattern from other operators:
 * - Takes inner computation producing multi-agent result
 * - Returns computation producing CoherenceResult<T>
 * - Supports threshold checking and callbacks
 *
 * Type constraint: T must extend HasVotes (have a votes array).
 *
 * @param innerComputation - Upstream computation (consensus, debate, dialectic)
 * @param innerMeta - Metadata from upstream AgentUnit
 * @param options - Coherence options (threshold, preset, callbacks)
 * @returns Computation producing CoherenceResult<T>
 *
 * @example
 * ```typescript
 * // Used internally by AgentUnit.coherence()
 * const computation = createCoherenceComputation(
 *   consensusComputation,
 *   metadata,
 *   { threshold: 0.80 }
 * );
 * ```
 *
 * 📝 BUILD[STORY-02.02]: Coherence computation factory
 */
export function createCoherenceComputation<T extends HasVotes>(
  innerComputation: AgentComputation<T>,
  _innerMeta: AgentUnitMetadata,
  options: CoherenceOptions = {},
): AgentComputation<CoherenceResult<T>> {
  // Resolve threshold upfront
  const threshold = resolveThreshold(options);

  return async (ctx: AgentContext): Promise<CoherenceResult<T>> => {
    // Execute upstream computation
    const result = await innerComputation(ctx);

    // Type guard validation (should be guaranteed by TypeScript, but runtime safety)
    if (!hasVotes(result)) {
      throw new Error(
        "[E102] Context Error: .coherence() requires upstream result with votes array. " +
          "Chain after .consensus(), .debate(), or .dialectic().",
      );
    }

    // Extract inputs for coherence calculation
    const coherenceInput = {
      votes: result.votes,
      contributions: hasContributions(result)
        ? result.contributions
        : undefined,
    };

    // Calculate coherence
    const coherence = calculateCompositeCoherence(coherenceInput, {
      weights: options.weights,
    });

    // Check threshold
    const meetsThreshold = coherence.composite >= threshold;

    // Handle low coherence
    if (!meetsThreshold) {
      // Call callback if provided
      if (options.onDrop) {
        await options.onDrop(coherence);
      }

      // Throw if failOnLowCoherence
      if (options.failOnLowCoherence) {
        throw new CoherenceError(coherence, threshold);
      }
    }

    // Return result with coherence
    return {
      result,
      coherence,
      meetsThreshold,
      threshold,
    };
  };
}
