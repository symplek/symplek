/**
 * @fileoverview Variance-Based Confidence Calculation
 * @description Tier 2b - Statistical confidence from numeric prediction variance
 * @module @weft/core/confidence/calculations/varianceConfidence
 * @since 2.0.0
 *
 * 📝 BUILD[01.06]: Variance confidence from research on numeric predictions
 *
 * @remarks
 * Variance measures spread in numeric predictions. Low variance indicates
 * agents agree on values. High variance indicates disagreement.
 *
 * Formula: varianceConfidence = 1 - min(σ² / max_σ², 1.0)
 *
 * Where:
 * - σ² = sample variance of predictions
 * - max_σ² = maximum expected variance (normalization constant)
 *
 * Properties:
 * - Range: [0, 1]
 * - Zero variance: 1.0 (perfect agreement)
 * - High variance: approaches 0.0
 * - Empty/single prediction: returns 1.0 (no variance)
 */

import type { Vote } from "../../types";
import { DEFAULT_MAX_VARIANCE } from "../config";
import type { ConfidenceSignal } from "../types";

/**
 * Result of variance confidence calculation.
 */
export interface VarianceConfidenceResult {
  /** Variance-based confidence [0, 1] */
  varianceConfidence: number;

  /** Raw variance */
  variance: number;

  /** Standard deviation */
  standardDeviation: number;

  /** Mean of predictions */
  mean: number;

  /** Coefficient of variation (CV) */
  coefficientOfVariation: number;

  /** Detailed signal for audit trail */
  signal: ConfidenceSignal;
}

/**
 * Calculate variance-based confidence from numeric predictions.
 *
 * @param predictions - Array of numeric predictions
 * @param maxVariance - Maximum variance for normalization
 * @param weight - Weight to assign to this signal
 * @returns Variance confidence result with full audit trail
 *
 * @remarks
 * The maxVariance parameter determines normalization. For bounded values
 * (e.g., confidence 0-1), maxVariance of 0.25 (max variance for [0,1])
 * is appropriate. For unbounded values, use domain knowledge to set
 * a reasonable maximum.
 *
 * @example
 * ```typescript
 * const result = calculateVarianceConfidence([0.85, 0.88, 0.82, 0.87]);
 * console.log(result.varianceConfidence); // ~0.99 (low variance)
 *
 * const spread = calculateVarianceConfidence([0.2, 0.5, 0.8, 0.9]);
 * console.log(spread.varianceConfidence); // ~0.40 (high variance)
 * ```
 */
export function calculateVarianceConfidence(
  predictions: number[],
  maxVariance: number = DEFAULT_MAX_VARIANCE,
  weight: number = 1.0,
): VarianceConfidenceResult {
  // Handle empty or single prediction
  if (!predictions || predictions.length <= 1) {
    const value = predictions?.length === 1 ? predictions[0] : 0;
    return {
      varianceConfidence: predictions?.length === 1 ? 1.0 : 0,
      variance: 0,
      standardDeviation: 0,
      mean: value,
      coefficientOfVariation: 0,
      signal: {
        value: predictions?.length === 1 ? 1.0 : 0,
        tier: 2,
        weight,
        formula:
          predictions?.length === 1
            ? "varianceConfidence = 1.0 (single prediction, variance = 0)"
            : "varianceConfidence = 0 (no predictions)",
        inputs: { predictionCount: predictions?.length ?? 0 },
      },
    };
  }

  // Calculate mean
  const n = predictions.length;
  const mean = predictions.reduce((sum, x) => sum + x, 0) / n;

  // Calculate sample variance: Σ(x - mean)² / (n - 1)
  const sumSquaredDiffs = predictions.reduce(
    (sum, x) => sum + (x - mean) ** 2,
    0,
  );
  const variance = sumSquaredDiffs / (n - 1);

  // Standard deviation
  const standardDeviation = Math.sqrt(variance);

  // Coefficient of variation (CV) - normalized measure
  // CV = σ / |μ| (undefined if mean = 0)
  const coefficientOfVariation =
    mean !== 0 ? standardDeviation / Math.abs(mean) : 0;

  // Normalize variance and convert to confidence
  // varianceConfidence = 1 - min(variance / maxVariance, 1.0)
  const normalizedVariance = Math.min(variance / maxVariance, 1.0);
  const varianceConfidence = 1 - normalizedVariance;

  // Build formula string for audit
  const formula =
    `varianceConfidence = 1 - min(σ²/max_σ², 1) = 1 - min(${variance.toFixed(6)}/${maxVariance}, 1) ` +
    `= 1 - ${normalizedVariance.toFixed(4)} = ${varianceConfidence.toFixed(4)}`;

  return {
    varianceConfidence,
    variance,
    standardDeviation,
    mean,
    coefficientOfVariation,
    signal: {
      value: varianceConfidence,
      tier: 2,
      weight,
      formula,
      inputs: {
        predictionCount: n,
        predictions,
        mean,
        variance,
        standardDeviation,
        maxVariance,
        normalizedVariance,
      },
    },
  };
}

/**
 * Extract numeric confidence values from votes for variance calculation.
 *
 * @param votes - Array of votes
 * @returns Array of confidence values
 *
 * @remarks
 * Helper function to extract the confidence numbers from Vote objects
 * for variance analysis.
 *
 * @example
 * ```typescript
 * const confidences = extractConfidencesFromVotes(votes);
 * const result = calculateVarianceConfidence(confidences);
 * ```
 */
export function extractConfidencesFromVotes(votes: Vote[]): number[] {
  return votes.map((v) => v.confidence);
}

/**
 * Calculate variance confidence from votes directly.
 *
 * @param votes - Array of votes
 * @param maxVariance - Maximum variance for normalization
 * @param weight - Weight for the signal
 * @returns Variance confidence result
 *
 * @remarks
 * Convenience function that extracts confidence values from votes
 * and calculates variance confidence in one step.
 */
export function calculateVarianceConfidenceFromVotes(
  votes: Vote[],
  maxVariance: number = DEFAULT_MAX_VARIANCE,
  weight: number = 1.0,
): VarianceConfidenceResult {
  const confidences = extractConfidencesFromVotes(votes);
  return calculateVarianceConfidence(confidences, maxVariance, weight);
}

/**
 * Calculate simple variance without the full result object.
 *
 * @param values - Array of numeric values
 * @returns Sample variance
 *
 * @example
 * ```typescript
 * const v = simpleVariance([1, 2, 3, 4, 5]);
 * console.log(v); // 2.5
 * ```
 */
export function simpleVariance(values: number[]): number {
  if (values.length <= 1) return 0;

  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const sumSquaredDiffs = values.reduce((sum, x) => sum + (x - mean) ** 2, 0);
  return sumSquaredDiffs / (values.length - 1);
}

/**
 * Calculate population variance (biased estimator).
 *
 * @param values - Array of numeric values
 * @returns Population variance
 *
 * @remarks
 * Uses N instead of N-1 in denominator. Appropriate when you have
 * the complete population, not a sample.
 */
export function populationVariance(values: number[]): number {
  if (values.length === 0) return 0;

  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const sumSquaredDiffs = values.reduce((sum, x) => sum + (x - mean) ** 2, 0);
  return sumSquaredDiffs / values.length;
}
