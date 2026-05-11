/**
 * @fileoverview Entropy-Based Coherence Calculation
 * @description Measures coherence from decision distribution entropy
 * @module weft-core/coherence/calculations/entropyCoherence
 * @since 2.1.0
 *
 * 📝 BUILD[STORY-01.04]: Entropy coherence implementation
 *
 * @remarks
 * Entropy-based coherence measures how concentrated decisions are.
 * Low entropy (unanimous decisions) indicates high coherence.
 * High entropy (spread decisions) indicates low coherence.
 *
 * Formula: coherence = 1 - H(votes) / H_max
 *
 * Where:
 * - H(votes) = -Σ p(d) × log₂(p(d)) for each decision d
 * - H_max = log₂(n) where n = number of unique decisions
 */

import type { Vote } from "weft-core";
import { DEFAULT_COHERENCE_WEIGHTS } from "../config";
import type { CoherenceSignal } from "../types";

// ─────────────────────────────────────────────────────────────────────────────
// ENTROPY COHERENCE RESULT
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Result of entropy coherence calculation.
 */
export interface EntropyCoherenceResult {
  /** Coherence value [0, 1] */
  coherence: number;
  /** Raw entropy value */
  entropy: number;
  /** Maximum possible entropy */
  maxEntropy: number;
  /** Decision distribution */
  distribution: Record<string, number>;
  /** Signal for composite calculation */
  signal: CoherenceSignal;
}

// ─────────────────────────────────────────────────────────────────────────────
// CALCULATION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Calculate entropy-based coherence from votes.
 *
 * @param votes - Array of votes with decisions
 * @param weight - Weight for this signal in composite (default from config)
 * @returns Entropy coherence result with signal
 *
 * @example
 * ```typescript
 * // Unanimous approval - maximum coherence
 * const unanimous = calculateEntropyCoherence([
 *   { agentId: 'a1', decision: 'approve', confidence: 0.9, weight: 1 },
 *   { agentId: 'a2', decision: 'approve', confidence: 0.9, weight: 1 },
 *   { agentId: 'a3', decision: 'approve', confidence: 0.9, weight: 1 },
 * ]);
 * // unanimous.coherence = 1.0
 *
 * // Split decision - lower coherence
 * const split = calculateEntropyCoherence([
 *   { agentId: 'a1', decision: 'approve', confidence: 0.9, weight: 1 },
 *   { agentId: 'a2', decision: 'reject', confidence: 0.9, weight: 1 },
 *   { agentId: 'a3', decision: 'abstain', confidence: 0.5, weight: 1 },
 * ]);
 * // split.coherence ≈ 0.0 (max entropy = max disorder)
 * ```
 */
export function calculateEntropyCoherence(
  votes: Vote[],
  weight: number = DEFAULT_COHERENCE_WEIGHTS.entropy,
): EntropyCoherenceResult {
  // Handle edge cases
  if (votes.length === 0) {
    return createResult(0, 0, 0, {}, weight);
  }

  if (votes.length === 1) {
    // Single vote: no disorder, maximum coherence
    return createResult(1.0, 0, 0, { [votes[0].decision]: 1 }, weight);
  }

  // Calculate decision distribution (weighted)
  const distribution = calculateDistribution(votes);
  const uniqueDecisions = Object.keys(distribution).length;

  // All same decision - maximum coherence
  if (uniqueDecisions === 1) {
    return createResult(1.0, 0, 0, distribution, weight);
  }

  // Calculate entropy
  const entropy = shannonEntropy(Object.values(distribution));

  // Maximum entropy: log₂(n) where n = number of unique decisions
  const maxEntropy = Math.log2(uniqueDecisions);

  // Convert to coherence: 1 - (entropy / max_entropy)
  const coherence = maxEntropy > 0 ? 1 - entropy / maxEntropy : 1.0;

  return createResult(coherence, entropy, maxEntropy, distribution, weight);
}

/**
 * Calculate entropy coherence from probability distribution.
 *
 * @param probabilities - Array of probabilities (should sum to 1)
 * @param weight - Weight for this signal in composite
 * @returns Entropy coherence result
 */
export function calculateEntropyCoherenceFromProbabilities(
  probabilities: number[],
  weight: number = DEFAULT_COHERENCE_WEIGHTS.entropy,
): EntropyCoherenceResult {
  if (probabilities.length === 0) {
    return createResult(0, 0, 0, {}, weight);
  }

  // Normalize probabilities
  const sum = probabilities.reduce((a, b) => a + b, 0);
  const normalized =
    sum > 0 ? probabilities.map((p) => p / sum) : probabilities;

  // Filter out zero probabilities
  const nonZero = normalized.filter((p) => p > 0);

  if (nonZero.length <= 1) {
    // All probability on one outcome - maximum coherence
    return createResult(1.0, 0, 0, {}, weight);
  }

  const entropy = shannonEntropy(nonZero);
  const maxEntropy = Math.log2(nonZero.length);
  const coherence = maxEntropy > 0 ? 1 - entropy / maxEntropy : 1.0;

  // Build distribution from probabilities
  const distribution: Record<string, number> = {};
  probabilities.forEach((p, i) => {
    if (p > 0) {
      distribution[`option_${i}`] = p;
    }
  });

  return createResult(coherence, entropy, maxEntropy, distribution, weight);
}

/**
 * Calculate Shannon entropy from probabilities.
 * H = -Σ p × log₂(p)
 *
 * @param probabilities - Array of probabilities
 * @returns Shannon entropy in bits
 */
export function shannonEntropy(probabilities: number[]): number {
  return -probabilities.reduce((sum, p) => {
    if (p <= 0) return sum;
    return sum + p * Math.log2(p);
  }, 0);
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Calculate decision distribution from votes (weighted).
 * Returns probabilities for each decision.
 */
function calculateDistribution(votes: Vote[]): Record<string, number> {
  const counts: Record<string, number> = {};
  let totalWeight = 0;

  for (const vote of votes) {
    const decision = vote.decision;
    const weight = vote.weight ?? 1;
    counts[decision] = (counts[decision] ?? 0) + weight;
    totalWeight += weight;
  }

  // Convert to probabilities
  const distribution: Record<string, number> = {};
  for (const [decision, count] of Object.entries(counts)) {
    distribution[decision] = count / totalWeight;
  }

  return distribution;
}

/**
 * Create entropy coherence result with signal.
 */
function createResult(
  coherence: number,
  entropy: number,
  maxEntropy: number,
  distribution: Record<string, number>,
  weight: number,
): EntropyCoherenceResult {
  return {
    coherence,
    entropy,
    maxEntropy,
    distribution,
    signal: {
      value: coherence,
      method: "entropy",
      weight,
      formula: "1 - H(votes) / log₂(n)",
      inputs: {
        entropy,
        maxEntropy,
        distribution,
        uniqueDecisions: Object.keys(distribution).length,
      },
    },
  };
}
