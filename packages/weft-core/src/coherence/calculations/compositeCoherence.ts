/**
 * @fileoverview Composite Coherence Calculation
 * @description Weighted combination of all coherence signals
 * @module weft-core/coherence/calculations/compositeCoherence
 * @since 1.0.0-beta.1
 *
 * 📝 BUILD[STORY-01.05]: Composite coherence implementation
 *
 * @remarks
 * Composite coherence combines multiple signals into a single score.
 * Only signals with available data contribute to the final score.
 * Weights are normalized among contributing signals.
 *
 * Formula: composite = Σ(signal_i × weight_i) / Σ(weight_i)
 *
 * Default weights:
 * - Agreement: 40% (most direct measure)
 * - Variance: 25% (confidence consistency)
 * - Entropy: 15% (decision distribution)
 * - Convergence: 15% (iterative refinement)
 * - Stigmergy: 5% (future pheromone trails)
 */

import { calculateAgreementRate } from "../../confidence/calculations/agreementRate";
import type { Vote } from "../../types";
import {
  COHERENCE_ALGORITHM_VERSION,
  DEFAULT_COHERENCE_WEIGHTS,
  mergeWeights,
} from "../config";
import type {
  CoherenceCalculationOptions,
  CoherenceInput,
  CoherenceMethod,
  CoherenceSignal,
  EnsembleCoherence,
} from "../types";
import { calculateEntropyCoherence } from "./entropyCoherence";
import { calculateVarianceCoherence } from "./varianceCoherence";

// ─────────────────────────────────────────────────────────────────────────────
// COMPOSITE CALCULATION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Calculate composite coherence from all available signals.
 *
 * @param input - Input containing votes, contributions, or convergence data
 * @param options - Calculation options including custom weights
 * @returns Complete coherence assessment with all signals
 *
 * @example
 * ```typescript
 * // From consensus result
 * const coherence = calculateCompositeCoherence(
 *   { votes: consensusResult.votes },
 *   { preset: 'standard' }
 * );
 *
 * // From debate result with convergence
 * const debateCoherence = calculateCompositeCoherence(
 *   {
 *     votes: debateResult.votes,
 *     contributions: debateResult.contributions,
 *     convergenceRounds: debateResult.rounds,
 *   }
 * );
 * ```
 */
export function calculateCompositeCoherence(
  input: CoherenceInput,
  options: CoherenceCalculationOptions = {},
): EnsembleCoherence {
  const weights = mergeWeights(options.weights);
  const signals: CoherenceSignal[] = [];
  const contributingMethods: CoherenceMethod[] = [];

  // Track signal values
  let agreementCoherence = 0;
  let varianceCoherence = 0;
  let entropyCoherence = 0;
  let convergenceCoherence: number | undefined;
  let stigmergyCoherence: number | undefined;

  // Track weighted sum for composite
  let weightedSum = 0;
  let totalWeight = 0;

  // ─── AGREEMENT (from votes) ─────────────────────────────────────────────────
  if (input.votes && input.votes.length > 0) {
    const result = calculateAgreementRate(input.votes, weights.agreement);
    agreementCoherence = result.agreementRate;

    signals.push({
      value: agreementCoherence,
      method: "agreement",
      weight: weights.agreement,
      formula: "majorityVotes / totalVotes",
      inputs: {
        majorityDecision: result.majorityDecision,
        majorityCount: result.majorityCount,
        voteCount: input.votes.length,
      },
    });

    contributingMethods.push("agreement");
    weightedSum += agreementCoherence * weights.agreement;
    totalWeight += weights.agreement;
  }

  // ─── VARIANCE (from vote confidences) ───────────────────────────────────────
  if (input.votes && input.votes.length > 1) {
    const result = calculateVarianceCoherence(input.votes, weights.variance);
    varianceCoherence = result.coherence;

    signals.push(result.signal);
    contributingMethods.push("variance");
    weightedSum += varianceCoherence * weights.variance;
    totalWeight += weights.variance;
  } else if (input.votes && input.votes.length === 1) {
    // Single vote - maximum variance coherence (no variance)
    varianceCoherence = 1.0;
    signals.push({
      value: 1.0,
      method: "variance",
      weight: weights.variance,
      formula: "1.0 (single vote)",
      inputs: { voteCount: 1 },
    });
    contributingMethods.push("variance");
    weightedSum += 1.0 * weights.variance;
    totalWeight += weights.variance;
  }

  // ─── ENTROPY (from decision distribution) ───────────────────────────────────
  if (input.votes && input.votes.length > 0) {
    const result = calculateEntropyCoherence(input.votes, weights.entropy);
    entropyCoherence = result.coherence;

    signals.push(result.signal);
    contributingMethods.push("entropy");
    weightedSum += entropyCoherence * weights.entropy;
    totalWeight += weights.entropy;
  }

  // ─── CONVERGENCE (from iterative refinement) ────────────────────────────────
  if (input.contributions && input.contributions.length > 0) {
    const result = calculateConvergenceCoherence(
      input.contributions,
      input.convergenceRounds,
      weights.convergence,
    );
    convergenceCoherence = result.coherence;

    signals.push(result.signal);
    contributingMethods.push("convergence");
    weightedSum += convergenceCoherence * weights.convergence;
    totalWeight += weights.convergence;
  }

  // ─── STIGMERGY (future - placeholder) ───────────────────────────────────────
  // Reserved for pheromone trail coherence
  // Will be implemented when stigmergic patterns are added

  // ─── COMPOSITE CALCULATION ──────────────────────────────────────────────────
  const composite = totalWeight > 0 ? weightedSum / totalWeight : 0;

  // Build formula string
  const formulaParts = contributingMethods.map((method) => {
    const signal = signals.find((s) => s.method === method);
    return `${method}(${signal?.value.toFixed(3) ?? 0}) × ${signal?.weight ?? 0}`;
  });
  const formula = `(${formulaParts.join(" + ")}) / ${totalWeight.toFixed(2)}`;

  return {
    agreementCoherence,
    varianceCoherence,
    entropyCoherence,
    convergenceCoherence,
    stigmergyCoherence,
    composite,
    metadata: {
      calculatedAt: Date.now(),
      contributingMethods,
      weights,
      formula,
      signals,
      algorithmVersion: COHERENCE_ALGORITHM_VERSION,
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// CONVERGENCE COHERENCE
// ─────────────────────────────────────────────────────────────────────────────

interface ConvergenceCoherenceResult {
  coherence: number;
  signal: CoherenceSignal;
}

/**
 * Calculate convergence coherence from contributions.
 *
 * @remarks
 * Convergence coherence measures how well agents converged:
 * - All agents done in few rounds = high coherence
 * - Many rounds with some agents still wanting more = lower coherence
 *
 * Formula: coherence = (1 - (maxRound / maxPossible)) × doneRatio
 */
function calculateConvergenceCoherence(
  contributions: Array<{ round: number; agentId: string; hadMore?: boolean }>,
  convergenceRounds?: number,
  weight: number = DEFAULT_COHERENCE_WEIGHTS.convergence,
): ConvergenceCoherenceResult {
  if (contributions.length === 0) {
    return {
      coherence: 0,
      signal: {
        value: 0,
        method: "convergence",
        weight,
        formula: "0 (no contributions)",
        inputs: { contributionCount: 0 },
      },
    };
  }

  // Find max round
  const maxRound = Math.max(...contributions.map((c) => c.round));
  const maxPossible = convergenceRounds ?? maxRound;

  // Count how many agents signaled "done" (hadMore: false)
  const agentStatuses = new Map<string, boolean>();
  for (const c of contributions) {
    // Track the last hadMore status for each agent
    if (c.hadMore !== undefined) {
      agentStatuses.set(c.agentId, c.hadMore);
    }
  }

  const totalAgents =
    agentStatuses.size || new Set(contributions.map((c) => c.agentId)).size;
  const doneAgents = Array.from(agentStatuses.values()).filter(
    (hadMore) => hadMore === false,
  ).length;
  const doneRatio = totalAgents > 0 ? doneAgents / totalAgents : 1.0;

  // Efficiency: earlier convergence = higher coherence
  const roundEfficiency =
    maxPossible > 0 ? 1 - (maxRound - 1) / maxPossible : 1.0;

  // Combine: coherence = efficiency × doneRatio
  const coherence = Math.max(0, Math.min(1, roundEfficiency * doneRatio));

  return {
    coherence,
    signal: {
      value: coherence,
      method: "convergence",
      weight,
      formula: `(1 - (${maxRound - 1}/${maxPossible})) × ${doneRatio.toFixed(2)}`,
      inputs: {
        maxRound,
        maxPossible,
        totalAgents,
        doneAgents,
        doneRatio,
        roundEfficiency,
      },
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// UTILITY FUNCTIONS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Quick coherence check for votes only.
 *
 * @param votes - Array of votes
 * @returns Composite coherence score [0, 1]
 */
export function quickCoherence(votes: Vote[]): number {
  const result = calculateCompositeCoherence({ votes });
  return result.composite;
}

/**
 * Check if coherence meets threshold.
 *
 * @param input - Coherence input
 * @param threshold - Minimum threshold
 * @param options - Calculation options
 * @returns True if composite coherence >= threshold
 */
export function meetsCoherenceThreshold(
  input: CoherenceInput,
  threshold: number,
  options?: CoherenceCalculationOptions,
): boolean {
  const result = calculateCompositeCoherence(input, options);
  return result.composite >= threshold;
}
