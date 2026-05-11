/**
 * @fileoverview Agreement Rate Confidence Calculation
 * @description Tier 1 - Immediate confidence from voting agreement
 * @module weft-core/confidence/calculations/agreementRate
 * @since 2.0.0
 *
 * 📝 BUILD[01.04]: Agreement rate calculation from research
 *
 * @remarks
 * Agreement rate is the simplest and most direct measure of consensus.
 * It measures what fraction of voters chose the most popular option.
 *
 * Formula: agreementRate = |majority_votes| / total_votes
 *
 * Properties:
 * - Range: [1/n, 1] where n = number of options
 * - Perfect agreement: 1.0
 * - Split vote: approaches 1/n as votes spread evenly
 * - Empty votes: returns 0.0 (no data)
 */

import type { Vote } from "weft-core";
import type { ConfidenceSignal } from "../types";

/**
 * Result of agreement rate calculation.
 */
export interface AgreementRateResult {
  /** Raw agreement rate [0, 1] */
  agreementRate: number;

  /** Detailed signal for audit trail */
  signal: ConfidenceSignal;

  /** Vote distribution by decision */
  distribution: Record<string, number>;

  /** The majority decision */
  majorityDecision: string | null;

  /** Number of votes for majority */
  majorityCount: number;
}

/**
 * Calculate agreement rate from votes.
 *
 * @param votes - Array of votes to analyze
 * @param weight - Weight to assign to this signal (for composite calculation)
 * @returns Agreement rate result with full audit trail
 *
 * @remarks
 * Handles weighted and unweighted votes. When votes have weights,
 * uses weighted counts for majority determination.
 *
 * @example
 * ```typescript
 * const result = calculateAgreementRate([
 *   { agentId: 'a1', decision: 'approve', confidence: 0.9, weight: 1 },
 *   { agentId: 'a2', decision: 'approve', confidence: 0.8, weight: 1 },
 *   { agentId: 'a3', decision: 'reject', confidence: 0.7, weight: 1 },
 * ]);
 *
 * console.log(result.agreementRate); // 0.667 (2/3 agree)
 * console.log(result.majorityDecision); // 'approve'
 * ```
 */
export function calculateAgreementRate(
  votes: Vote[],
  weight: number = 1.0,
): AgreementRateResult {
  // Handle empty votes
  if (!votes || votes.length === 0) {
    return {
      agreementRate: 0,
      signal: {
        value: 0,
        tier: 1,
        weight,
        formula: "agreementRate = 0 (no votes)",
        inputs: { voteCount: 0 },
      },
      distribution: {},
      majorityDecision: null,
      majorityCount: 0,
    };
  }

  // Count votes by decision (weighted)
  const distribution: Record<string, number> = {};
  let totalWeight = 0;

  for (const vote of votes) {
    const voteWeight = vote.weight ?? 1;
    distribution[vote.decision] =
      (distribution[vote.decision] ?? 0) + voteWeight;
    totalWeight += voteWeight;
  }

  // Find majority decision
  let majorityDecision: string | null = null;
  let majorityCount = 0;

  for (const [decision, count] of Object.entries(distribution)) {
    if (count > majorityCount) {
      majorityCount = count;
      majorityDecision = decision;
    }
  }

  // Calculate agreement rate
  const agreementRate = totalWeight > 0 ? majorityCount / totalWeight : 0;

  // Build formula string for audit
  const formula = `agreementRate = ${majorityCount.toFixed(2)} / ${totalWeight.toFixed(2)} = ${agreementRate.toFixed(4)}`;

  return {
    agreementRate,
    signal: {
      value: agreementRate,
      tier: 1,
      weight,
      formula,
      inputs: {
        voteCount: votes.length,
        totalWeight,
        majorityCount,
        majorityDecision,
        distribution,
      },
    },
    distribution,
    majorityDecision,
    majorityCount,
  };
}

/**
 * Calculate simple (unweighted) agreement rate.
 *
 * @param votes - Array of votes
 * @returns Simple agreement rate [0, 1]
 *
 * @remarks
 * Convenience function for cases where you just need the rate
 * without the full audit trail.
 *
 * @example
 * ```typescript
 * const rate = simpleAgreementRate(votes);
 * if (rate > 0.8) {
 *   // Strong agreement
 * }
 * ```
 */
export function simpleAgreementRate(votes: Vote[]): number {
  if (!votes || votes.length === 0) {
    return 0;
  }

  // Count by decision (ignoring weights for simplicity)
  const counts: Record<string, number> = {};
  for (const vote of votes) {
    counts[vote.decision] = (counts[vote.decision] ?? 0) + 1;
  }

  // Find max count
  const maxCount = Math.max(...Object.values(counts));
  return maxCount / votes.length;
}

/**
 * Check if agreement rate indicates unanimous consent.
 *
 * @param votes - Array of votes
 * @param threshold - Threshold for "unanimous" (default 1.0)
 * @returns True if agreement rate >= threshold
 *
 * @example
 * ```typescript
 * if (isUnanimous(votes)) {
 *   // All agents agree
 * }
 *
 * // Allow near-unanimous (95%+)
 * if (isUnanimous(votes, 0.95)) {
 *   // Almost all agents agree
 * }
 * ```
 */
export function isUnanimous(votes: Vote[], threshold: number = 1.0): boolean {
  return simpleAgreementRate(votes) >= threshold;
}
