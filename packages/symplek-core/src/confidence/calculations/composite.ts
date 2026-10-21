/**
 * @fileoverview Composite Confidence Calculation
 * @description Combines all tier signals into a single weighted confidence score
 * @module @symplek/core/confidence/calculations/composite
 * @since 2.0.0
 *
 * 📝 BUILD[01.08]: Main entry point for objective confidence calculation
 *
 * @remarks
 * This module orchestrates all confidence tiers into a single composite score.
 * It adaptively includes only tiers for which data is available, renormalizing
 * weights as needed.
 *
 * Key features:
 * - Adaptive tier inclusion based on available data
 * - Weight renormalization when tiers are missing
 * - Complete audit trail for every calculation
 * - Preset-based and custom weight configurations
 */

import { ALGORITHM_VERSION, DEFAULT_WEIGHTS, WEIGHT_PRESETS } from "../config";
import type {
  ConfidenceCalculationOptions,
  ConfidenceInput,
  ConfidenceMetadata,
  ConfidenceSignal,
  ConfidenceWeights,
  ObjectiveConfidence,
  TierName,
} from "../types";
import { calculateAgreementRate } from "./agreementRate";
import { calculateEntropyConfidence } from "./entropyConfidence";
import {
  calculateRetryConfidence,
  calculateVerificationDepthConfidence,
} from "./retryConfidence";
import {
  calculateVarianceConfidence,
  extractConfidencesFromVotes,
} from "./varianceConfidence";

// ─────────────────────────────────────────────────────────────────────────────
// MAIN CALCULATION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Calculate objective confidence from available inputs.
 *
 * @param input - Available confidence inputs
 * @param options - Calculation options
 * @returns Complete objective confidence result with audit trail
 *
 * @remarks
 * This is the main entry point for objective confidence calculation.
 * It automatically adapts to available data:
 * - If votes are provided: calculates agreement rate, entropy, and variance from votes
 * - If predictions are provided: calculates variance from predictions
 * - If retryCount is provided: calculates retry confidence
 * - If verificationSteps is provided: calculates verification depth
 *
 * Missing tiers are assigned value 0 and excluded from the weighted average
 * by renormalizing remaining weights.
 *
 * @example
 * ```typescript
 * // From consensus votes
 * const result = calculateObjectiveConfidence({
 *   votes: consensusResult.votes,
 *   retryCount: 0,
 * });
 *
 * // With custom weights
 * const custom = calculateObjectiveConfidence(
 *   { votes, retryCount: 2 },
 *   { preset: 'stability' }
 * );
 *
 * // Access results
 * console.log(result.composite);        // 0.87
 * console.log(result.agreementRate);    // 0.92
 * console.log(result.metadata.formula); // Shows calculation
 * ```
 */
export function calculateObjectiveConfidence(
  input: ConfidenceInput,
  options: ConfidenceCalculationOptions = {},
): ObjectiveConfidence {
  const startTime = Date.now();

  // Resolve weights from preset and overrides
  const baseWeights = options.preset
    ? WEIGHT_PRESETS[options.preset]
    : DEFAULT_WEIGHTS;

  const weights: ConfidenceWeights = options.weights
    ? { ...baseWeights, ...options.weights }
    : baseWeights;

  // Collect signals from available data
  const signals: ConfidenceSignal[] = [];
  const contributingTiers: TierName[] = [];

  // Track which tiers have data
  const tierData: Record<TierName, { value: number; weight: number }> = {
    immediate: { value: 0, weight: 0 },
    statistical: { value: 0, weight: 0 },
    behavioral: { value: 0, weight: 0 },
    bayesian: { value: 0, weight: 0 },
  };

  // ─── Tier 1: Agreement Rate ─────────────────────────────────────────────────

  let agreementRate = 0;
  if (input.votes && input.votes.length > 0) {
    const result = calculateAgreementRate(input.votes, weights.agreementRate);
    agreementRate = result.agreementRate;
    signals.push(result.signal);
    tierData.immediate = {
      value: agreementRate,
      weight: weights.agreementRate,
    };
    contributingTiers.push("immediate");
  }

  // ─── Tier 2a: Entropy Confidence ────────────────────────────────────────────

  let entropyConfidence = 0;
  if (input.votes && input.votes.length > 1) {
    const result = calculateEntropyConfidence(
      input.votes,
      weights.entropyConfidence,
    );
    entropyConfidence = result.entropyConfidence;
    signals.push(result.signal);
    // Entropy is part of statistical tier - accumulate
    tierData.statistical.value += entropyConfidence * weights.entropyConfidence;
    tierData.statistical.weight += weights.entropyConfidence;
    if (!contributingTiers.includes("statistical")) {
      contributingTiers.push("statistical");
    }
  }

  // ─── Tier 2b: Variance Confidence ───────────────────────────────────────────

  let varianceConfidence = 0;
  const predictions =
    input.predictions ??
    (input.votes ? extractConfidencesFromVotes(input.votes) : undefined);

  if (predictions && predictions.length > 1) {
    const result = calculateVarianceConfidence(
      predictions,
      options.maxVariance,
      weights.varianceConfidence,
    );
    varianceConfidence = result.varianceConfidence;
    signals.push(result.signal);
    tierData.statistical.value +=
      varianceConfidence * weights.varianceConfidence;
    tierData.statistical.weight += weights.varianceConfidence;
    if (!contributingTiers.includes("statistical")) {
      contributingTiers.push("statistical");
    }
  }

  // ─── Tier 3a: Retry Confidence ──────────────────────────────────────────────

  let retryConfidence = 1.0; // Default to 1.0 (no retries = full confidence)
  if (input.retryCount !== undefined) {
    const result = calculateRetryConfidence(
      input.retryCount,
      { lambda: options.retryLambda },
      weights.retryConfidence,
    );
    retryConfidence = result.retryConfidence;
    signals.push(result.signal);
    tierData.behavioral.value += retryConfidence * weights.retryConfidence;
    tierData.behavioral.weight += weights.retryConfidence;
    if (!contributingTiers.includes("behavioral")) {
      contributingTiers.push("behavioral");
    }
  }

  // ─── Tier 3b: Verification Depth ────────────────────────────────────────────

  let verificationDepth = 0;
  if (input.verificationSteps !== undefined) {
    const result = calculateVerificationDepthConfidence(
      input.verificationSteps,
      3, // Default max steps
      weights.verificationDepth,
    );
    verificationDepth = result.verificationConfidence;
    signals.push(result.signal);
    tierData.behavioral.value += verificationDepth * weights.verificationDepth;
    tierData.behavioral.weight += weights.verificationDepth;
    if (!contributingTiers.includes("behavioral")) {
      contributingTiers.push("behavioral");
    }
  }

  // ─── Tier 4: Bayesian Posterior (optional) ──────────────────────────────────

  let bayesianPosterior: number | undefined;
  if (
    options.includeBayesian &&
    input.historicalSuccessRate !== undefined &&
    weights.bayesianPosterior !== undefined
  ) {
    // Simple Bayesian update: P(correct) = prior
    // More sophisticated would use likelihood from current data
    bayesianPosterior = input.historicalSuccessRate;
    signals.push({
      value: bayesianPosterior,
      tier: 4,
      weight: weights.bayesianPosterior,
      formula: `bayesianPosterior = ${bayesianPosterior.toFixed(4)} (from historical success rate)`,
      inputs: {
        historicalSuccessRate: input.historicalSuccessRate,
        historicalSampleCount: input.historicalSampleCount,
      },
    });
    tierData.bayesian = {
      value: bayesianPosterior,
      weight: weights.bayesianPosterior,
    };
    contributingTiers.push("bayesian");
  }

  // ─── Calculate Composite ────────────────────────────────────────────────────

  const { composite, formula } = calculateComposite(
    signals,
    weights,
    contributingTiers,
  );

  // ─── Build Metadata ─────────────────────────────────────────────────────────

  const metadata: ConfidenceMetadata = {
    calculatedAt: startTime,
    contributingTiers,
    weights,
    formula,
    signals,
    algorithmVersion: ALGORITHM_VERSION,
  };

  return {
    agreementRate,
    entropyConfidence,
    varianceConfidence,
    retryConfidence,
    verificationDepth,
    bayesianPosterior,
    composite,
    metadata,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// COMPOSITE CALCULATION HELPER
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Calculate weighted composite from signals.
 *
 * @param signals - Array of confidence signals
 * @param weights - Weight configuration
 * @param contributingTiers - Tiers that contributed data
 * @returns Composite value and formula string
 */
function calculateComposite(
  signals: ConfidenceSignal[],
  _weights: ConfidenceWeights,
  contributingTiers: TierName[],
): { composite: number; formula: string } {
  if (signals.length === 0) {
    return {
      composite: 0,
      formula: "composite = 0 (no signals available)",
    };
  }

  // Calculate total weight of contributing signals
  const totalWeight = signals.reduce((sum, s) => sum + s.weight, 0);

  if (totalWeight === 0) {
    return {
      composite: 0,
      formula: "composite = 0 (total weight = 0)",
    };
  }

  // Calculate weighted sum, renormalizing for missing tiers
  let weightedSum = 0;
  const terms: string[] = [];

  for (const signal of signals) {
    const normalizedWeight = signal.weight / totalWeight;
    const contribution = signal.value * normalizedWeight;
    weightedSum += contribution;
    terms.push(`${signal.value.toFixed(4)} × ${normalizedWeight.toFixed(4)}`);
  }

  // Build formula string
  const formula = `composite = (${terms.join(" + ")}) = ${weightedSum.toFixed(4)} [tiers: ${contributingTiers.join(", ")}]`;

  return {
    composite: weightedSum,
    formula,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// CONVENIENCE FUNCTIONS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Quick confidence calculation from votes only.
 *
 * @param votes - Votes to analyze
 * @returns Composite confidence value
 *
 * @remarks
 * Convenience function for common use case of calculating
 * confidence from consensus votes without full options.
 */
export function quickConfidence(votes: ConfidenceInput["votes"]): number {
  if (!votes || votes.length === 0) return 0;
  return calculateObjectiveConfidence({ votes }).composite;
}

/**
 * Check if confidence meets threshold.
 *
 * @param confidence - ObjectiveConfidence result
 * @param threshold - Minimum threshold
 * @returns True if composite >= threshold
 */
export function meetsThreshold(
  confidence: ObjectiveConfidence,
  threshold: number,
): boolean {
  return confidence.composite >= threshold;
}

/**
 * Get confidence tier label for a composite score.
 *
 * @param composite - Composite confidence value
 * @param thresholds - Threshold values
 * @returns Label: 'high', 'medium', or 'low'
 */
export function getConfidenceTier(
  composite: number,
  thresholds: { low: number; high: number } = { low: 0.5, high: 0.8 },
): "high" | "medium" | "low" {
  if (composite >= thresholds.high) return "high";
  if (composite >= thresholds.low) return "medium";
  return "low";
}
