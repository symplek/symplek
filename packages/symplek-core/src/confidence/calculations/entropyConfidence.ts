/**
 * @fileoverview Entropy-Based Confidence Calculation
 * @description Tier 2a - Statistical confidence from vote distribution entropy
 * @module @symplek/core/confidence/calculations/entropyConfidence
 * @since 2.0.0
 *
 * 📝 BUILD[01.05]: Entropy confidence from information theory research
 *
 * @remarks
 * Entropy measures uncertainty in the vote distribution. Low entropy
 * indicates high certainty (votes concentrated on one option).
 * High entropy indicates uncertainty (votes spread across options).
 *
 * Formula: entropyConfidence = 1 - H(votes) / H_max
 *
 * Where:
 * - H(votes) = -Σ p(x) × log2(p(x)) (Shannon entropy)
 * - H_max = log2(n) (maximum entropy for n options)
 *
 * Properties:
 * - Range: [0, 1]
 * - Perfect agreement: 1.0 (entropy = 0)
 * - Perfect split: 0.0 (maximum entropy)
 * - Empty votes: returns 0.0 (no data)
 */

import type { Vote } from "../../types";
import type { ConfidenceSignal } from "../types";

/**
 * Result of entropy confidence calculation.
 */
export interface EntropyConfidenceResult {
  /** Entropy-based confidence [0, 1] */
  entropyConfidence: number;

  /** Raw Shannon entropy in bits */
  entropy: number;

  /** Maximum possible entropy for this distribution */
  maxEntropy: number;

  /** Normalized entropy [0, 1] */
  normalizedEntropy: number;

  /** Detailed signal for audit trail */
  signal: ConfidenceSignal;
}

/**
 * Calculate entropy-based confidence from votes.
 *
 * @param votes - Array of votes to analyze
 * @param weight - Weight to assign to this signal (for composite calculation)
 * @returns Entropy confidence result with full audit trail
 *
 * @remarks
 * Uses Shannon entropy (base 2) for information-theoretic interpretation.
 * Handles edge cases:
 * - Empty votes: returns 0 confidence
 * - Single vote: returns 1.0 (no uncertainty)
 * - Unanimous votes: returns 1.0 (entropy = 0)
 *
 * @example
 * ```typescript
 * const result = calculateEntropyConfidence([
 *   { agentId: 'a1', decision: 'approve', confidence: 0.9, weight: 1 },
 *   { agentId: 'a2', decision: 'approve', confidence: 0.8, weight: 1 },
 *   { agentId: 'a3', decision: 'reject', confidence: 0.7, weight: 1 },
 * ]);
 *
 * console.log(result.entropyConfidence); // ~0.08 (low entropy, high confidence)
 * console.log(result.entropy); // ~0.92 bits
 * ```
 */
export function calculateEntropyConfidence(
  votes: Vote[],
  weight: number = 1.0,
): EntropyConfidenceResult {
  // Handle empty votes
  if (!votes || votes.length === 0) {
    return {
      entropyConfidence: 0,
      entropy: 0,
      maxEntropy: 0,
      normalizedEntropy: 0,
      signal: {
        value: 0,
        tier: 2,
        weight,
        formula: "entropyConfidence = 0 (no votes)",
        inputs: { voteCount: 0 },
      },
    };
  }

  // Count votes by decision
  const counts: Record<string, number> = {};
  for (const vote of votes) {
    counts[vote.decision] = (counts[vote.decision] ?? 0) + 1;
  }

  const totalVotes = votes.length;
  const uniqueDecisions = Object.keys(counts).length;

  // Handle single decision (no uncertainty)
  if (uniqueDecisions <= 1) {
    return {
      entropyConfidence: 1.0,
      entropy: 0,
      maxEntropy: 0,
      normalizedEntropy: 0,
      signal: {
        value: 1.0,
        tier: 2,
        weight,
        formula: "entropyConfidence = 1.0 (unanimous, entropy = 0)",
        inputs: {
          voteCount: totalVotes,
          uniqueDecisions,
          counts,
        },
      },
    };
  }

  // Calculate Shannon entropy: H = -Σ p(x) × log2(p(x))
  let entropy = 0;
  for (const count of Object.values(counts)) {
    const probability = count / totalVotes;
    if (probability > 0) {
      entropy -= probability * Math.log2(probability);
    }
  }

  // Maximum entropy for n options: H_max = log2(n)
  const maxEntropy = Math.log2(uniqueDecisions);

  // Normalized entropy [0, 1]
  const normalizedEntropy = maxEntropy > 0 ? entropy / maxEntropy : 0;

  // Entropy confidence: 1 - normalized_entropy
  const entropyConfidence = 1 - normalizedEntropy;

  // Build formula string for audit
  const formula =
    `entropyConfidence = 1 - H/H_max = 1 - ${entropy.toFixed(4)}/${maxEntropy.toFixed(4)} ` +
    `= 1 - ${normalizedEntropy.toFixed(4)} = ${entropyConfidence.toFixed(4)}`;

  return {
    entropyConfidence,
    entropy,
    maxEntropy,
    normalizedEntropy,
    signal: {
      value: entropyConfidence,
      tier: 2,
      weight,
      formula,
      inputs: {
        voteCount: totalVotes,
        uniqueDecisions,
        counts,
        entropy,
        maxEntropy,
        normalizedEntropy,
      },
    },
  };
}

/**
 * Calculate raw Shannon entropy of a distribution.
 *
 * @param probabilities - Array of probabilities (must sum to 1)
 * @returns Shannon entropy in bits
 *
 * @remarks
 * Utility function for direct entropy calculation from probabilities.
 * Useful for custom distributions not derived from votes.
 *
 * @example
 * ```typescript
 * // Maximum uncertainty for binary choice
 * const binary = shannonEntropy([0.5, 0.5]); // 1.0 bit
 *
 * // Low uncertainty
 * const skewed = shannonEntropy([0.9, 0.1]); // ~0.47 bits
 * ```
 */
export function shannonEntropy(probabilities: number[]): number {
  let entropy = 0;
  for (const p of probabilities) {
    if (p > 0) {
      entropy -= p * Math.log2(p);
    }
  }
  return entropy;
}

/**
 * Convert vote counts to entropy confidence directly.
 *
 * @param counts - Vote counts by decision
 * @returns Entropy confidence [0, 1]
 *
 * @remarks
 * Convenience function when you have pre-computed counts.
 *
 * @example
 * ```typescript
 * const confidence = countsToEntropyConfidence({
 *   approve: 8,
 *   reject: 2,
 * });
 * ```
 */
export function countsToEntropyConfidence(
  counts: Record<string, number>,
): number {
  const values = Object.values(counts);
  const total = values.reduce((a, b) => a + b, 0);

  if (total === 0 || values.length <= 1) {
    return total === 0 ? 0 : 1.0;
  }

  const probabilities = values.map((c) => c / total);
  const entropy = shannonEntropy(probabilities);
  const maxEntropy = Math.log2(values.length);

  return 1 - entropy / maxEntropy;
}
