/**
 * @fileoverview Variance-Based Coherence Calculation
 * @description Measures coherence from vote confidence variance
 * @module weft-core/coherence/calculations/varianceCoherence
 * @since 2.1.0
 *
 * 📝 BUILD[STORY-01.03]: Variance coherence implementation
 *
 * @remarks
 * Variance-based coherence measures how consistent agent confidences are.
 * Low variance (similar confidences) indicates high coherence.
 * High variance (spread confidences) indicates low coherence.
 *
 * Formula: coherence = 1 - min(σ² / σ²_max, 1.0)
 *
 * Where:
 * - σ² = sample variance of vote confidences
 * - σ²_max = 0.25 (theoretical max variance for values in [0,1])
 */

import type { Vote } from "weft-core";
import { DEFAULT_COHERENCE_WEIGHTS } from "../config";
import type { CoherenceSignal } from "../types";

// ─────────────────────────────────────────────────────────────────────────────
// VARIANCE COHERENCE RESULT
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Result of variance coherence calculation.
 */
export interface VarianceCoherenceResult {
  /** Coherence value [0, 1] */
  coherence: number;
  /** Raw variance value */
  variance: number;
  /** Mean confidence */
  mean: number;
  /** Number of votes analyzed */
  voteCount: number;
  /** Signal for composite calculation */
  signal: CoherenceSignal;
}

// ─────────────────────────────────────────────────────────────────────────────
// CALCULATION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Maximum theoretical variance for values in [0, 1] range.
 * Occurs when half values are 0 and half are 1: variance = 0.25
 */
const MAX_VARIANCE = 0.25;

/**
 * Calculate variance-based coherence from votes.
 *
 * @param votes - Array of votes with confidence values
 * @param weight - Weight for this signal in composite (default from config)
 * @returns Variance coherence result with signal
 *
 * @example
 * ```typescript
 * const result = calculateVarianceCoherence([
 *   { agentId: 'a1', decision: 'approve', confidence: 0.9, weight: 1 },
 *   { agentId: 'a2', decision: 'approve', confidence: 0.85, weight: 1 },
 *   { agentId: 'a3', decision: 'approve', confidence: 0.88, weight: 1 },
 * ]);
 * // result.coherence ≈ 0.99 (low variance = high coherence)
 * ```
 */
export function calculateVarianceCoherence(
  votes: Vote[],
  weight: number = DEFAULT_COHERENCE_WEIGHTS.variance,
): VarianceCoherenceResult {
  // Handle edge cases
  if (votes.length === 0) {
    return createResult(0, 0, 0, 0, weight);
  }

  if (votes.length === 1) {
    // Single vote: no variance, maximum coherence
    return createResult(1.0, 0, votes[0].confidence, 1, weight);
  }

  // Extract confidences
  const confidences = votes.map((v) => v.confidence);

  // Calculate mean
  const n = confidences.length;
  const mean = confidences.reduce((sum, c) => sum + c, 0) / n;

  // Calculate sample variance: Σ(x - μ)² / n
  const variance = confidences.reduce((sum, c) => sum + (c - mean) ** 2, 0) / n;

  // Convert to coherence: 1 - (variance / max_variance), clamped to [0, 1]
  const normalizedVariance = Math.min(variance / MAX_VARIANCE, 1.0);
  const coherence = 1 - normalizedVariance;

  return createResult(coherence, variance, mean, n, weight);
}

/**
 * Calculate variance coherence from raw confidence values.
 *
 * @param confidences - Array of confidence values [0, 1]
 * @param weight - Weight for this signal in composite
 * @returns Variance coherence result
 */
export function calculateVarianceCoherenceFromConfidences(
  confidences: number[],
  weight: number = DEFAULT_COHERENCE_WEIGHTS.variance,
): VarianceCoherenceResult {
  // Convert to minimal vote structure
  const votes: Vote[] = confidences.map((confidence, i) => ({
    agentId: `agent_${i}`,
    decision: "approve",
    confidence,
    weight: 1,
  }));

  return calculateVarianceCoherence(votes, weight);
}

/**
 * Calculate simple variance from numeric values.
 * Utility for testing and external use.
 *
 * @param values - Array of numeric values
 * @returns Sample variance
 */
export function simpleVariance(values: number[]): number {
  if (values.length === 0) return 0;
  if (values.length === 1) return 0;

  const n = values.length;
  const mean = values.reduce((sum, v) => sum + v, 0) / n;
  return values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / n;
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create variance coherence result with signal.
 */
function createResult(
  coherence: number,
  variance: number,
  mean: number,
  voteCount: number,
  weight: number,
): VarianceCoherenceResult {
  return {
    coherence,
    variance,
    mean,
    voteCount,
    signal: {
      value: coherence,
      method: "variance",
      weight,
      formula: "1 - min(σ² / 0.25, 1.0)",
      inputs: {
        variance,
        mean,
        voteCount,
        maxVariance: MAX_VARIANCE,
      },
    },
  };
}
