/**
 * @fileoverview Objective Confidence Configuration
 * @description Default weights, presets, and thresholds for confidence calculation
 * @module weft-core/confidence/config
 * @since 1.0.0-beta.1
 *
 * 📝 BUILD[01.03]: Configuration constants from architecture design
 */

import type {
  ConfidencePreset,
  ConfidenceThresholds,
  ConfidenceWeights,
} from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// DEFAULT WEIGHTS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Default balanced weights for composite confidence calculation.
 *
 * @remarks
 * These weights sum to 1.0 and provide a balanced assessment across all tiers.
 * Derived from research findings on optimal tier combinations.
 *
 * Distribution rationale:
 * - Agreement Rate (30%): Primary signal, most direct measure of consensus
 * - Entropy (20%): Complements agreement with distribution analysis
 * - Variance (15%): Captures numeric prediction consistency
 * - Retry (20%): Strong behavioral signal of stability
 * - Verification (15%): Accounts for validation depth
 *
 * Total: 30 + 20 + 15 + 20 + 15 = 100%
 */
export const DEFAULT_WEIGHTS: ConfidenceWeights = {
  agreementRate: 0.3,
  entropyConfidence: 0.2,
  varianceConfidence: 0.15,
  retryConfidence: 0.2,
  verificationDepth: 0.15,
  // bayesianPosterior is optional, not included in default
};

// ─────────────────────────────────────────────────────────────────────────────
// WEIGHT PRESETS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Domain-specific weight presets.
 *
 * @remarks
 * Different use cases benefit from different tier weightings.
 * Select the preset that best matches your decision domain.
 */
export const WEIGHT_PRESETS: Record<ConfidencePreset, ConfidenceWeights> = {
  /**
   * Balanced preset (default)
   * Equal consideration of all available signals.
   */
  balanced: DEFAULT_WEIGHTS,

  /**
   * Consensus-focused preset
   * Emphasizes agreement metrics for voting scenarios.
   * Use when agent unanimity is the primary concern.
   */
  consensus: {
    agreementRate: 0.45,
    entropyConfidence: 0.3,
    varianceConfidence: 0.05,
    retryConfidence: 0.1,
    verificationDepth: 0.1,
  },

  /**
   * Stability-focused preset
   * Emphasizes behavioral signals for reliability assessment.
   * Use when execution stability is critical.
   */
  stability: {
    agreementRate: 0.15,
    entropyConfidence: 0.1,
    varianceConfidence: 0.15,
    retryConfidence: 0.4,
    verificationDepth: 0.2,
  },

  /**
   * Precision-focused preset
   * Emphasizes statistical signals for numeric predictions.
   * Use when prediction accuracy is paramount.
   */
  precision: {
    agreementRate: 0.15,
    entropyConfidence: 0.25,
    varianceConfidence: 0.35,
    retryConfidence: 0.15,
    verificationDepth: 0.1,
  },

  /**
   * Bayesian preset (requires historical data)
   * Incorporates prior knowledge for informed decisions.
   * Only use when historicalSuccessRate is available.
   */
  bayesian: {
    agreementRate: 0.2,
    entropyConfidence: 0.15,
    varianceConfidence: 0.1,
    retryConfidence: 0.15,
    verificationDepth: 0.1,
    bayesianPosterior: 0.3,
  },

  /**
   * Gantt/Schedule generation preset
   * Optimized for multi-specialist schedule generation.
   * Emphasizes cross-specialist agreement and schedule consistency.
   *
   * @remarks
   * - Agreement Rate (40%): Critical that specialists agree on dates
   * - Entropy (25%): Some divergence acceptable in estimates
   * - Variance (25%): Schedule scores should be consistent
   * - Retry (5%): Less relevant for batch generation
   * - Verification (5%): Schedule outputs typically verified later
   */
  gantt: {
    agreementRate: 0.4,
    entropyConfidence: 0.25,
    varianceConfidence: 0.25,
    retryConfidence: 0.05,
    verificationDepth: 0.05,
  },

  /**
   * High-stakes preset
   * For critical decisions where confidence must be maximized.
   * Heavily weights agreement and verification.
   *
   * @remarks
   * Use when:
   * - Decision is irreversible or expensive
   * - Multiple agents must strongly agree
   * - Human verification is expected
   */
  highStakes: {
    agreementRate: 0.45,
    entropyConfidence: 0.15,
    varianceConfidence: 0.1,
    retryConfidence: 0.1,
    verificationDepth: 0.2,
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// CONFIDENCE THRESHOLDS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Decision thresholds for confidence-based routing.
 *
 * @remarks
 * These thresholds are derived from research on optimal decision boundaries.
 * They should be calibrated to your specific use case and risk tolerance.
 *
 * - Below `low` (< 0.5): Low confidence, require human review
 * - Between `low` and `high` (0.5-0.8): Medium confidence, proceed with caution
 * - Above `high` (> 0.8): High confidence, safe to auto-approve
 * - Below `minimum` (< 0.3): Insufficient data, reject or defer
 */
export const CONFIDENCE_THRESHOLDS: ConfidenceThresholds = {
  /** Below this value = low confidence, requires human review */
  low: 0.5,

  /** Above this value = high confidence, safe to auto-approve */
  high: 0.8,

  /** Below this value = reject or defer, insufficient confidence */
  minimum: 0.3,
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// CALCULATION CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Default lambda for exponential retry decay.
 *
 * @remarks
 * Confidence = e^(-λ × retry_count)
 * λ = 0.5 means:
 * - 0 retries: 1.0 confidence
 * - 1 retry: 0.61 confidence
 * - 2 retries: 0.37 confidence
 * - 3 retries: 0.22 confidence
 */
export const DEFAULT_RETRY_LAMBDA = 0.5;

/**
 * Default maximum variance for normalization.
 *
 * @remarks
 * Variance confidence = 1 - (variance / maxVariance)
 * This caps the maximum expected variance for normalization.
 */
export const DEFAULT_MAX_VARIANCE = 1.0;

/**
 * Confidence floor for retry calculations.
 *
 * @remarks
 * Even after many retries, confidence should not go to zero.
 * This provides a minimum bound for retry-based confidence.
 */
export const RETRY_CONFIDENCE_FLOOR = 0.1;

/**
 * Maximum retries for linear confidence calculation.
 *
 * @remarks
 * For linear decay: confidence = 1 - (retryCount / maxRetries)
 */
export const DEFAULT_MAX_RETRIES = 5;

/**
 * Algorithm version for audit trails.
 *
 * @remarks
 * Bump this when calculation algorithms change to ensure
 * reproducibility of historical confidence values.
 */
export const ALGORITHM_VERSION = "1.0.0";

// ─────────────────────────────────────────────────────────────────────────────
// VALIDATION UTILITIES
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Validate that confidence weights sum to 1.0 (within floating point tolerance).
 *
 * @param weights - The weights to validate
 * @throws Error if weights do not sum to approximately 1.0
 *
 * @example
 * ```typescript
 * validateWeights(DEFAULT_WEIGHTS); // OK
 * validateWeights({ agreementRate: 0.5, ... }); // Throws if sum ≠ 1.0
 * ```
 */
export function validateWeights(weights: ConfidenceWeights): void {
  const sum =
    weights.agreementRate +
    weights.entropyConfidence +
    weights.varianceConfidence +
    weights.retryConfidence +
    weights.verificationDepth +
    (weights.bayesianPosterior ?? 0);

  const tolerance = 0.001;

  if (Math.abs(sum - 1.0) > tolerance) {
    throw new Error(
      `Confidence weights must sum to 1.0, got ${sum.toFixed(4)}. ` +
        `Weights: agreementRate=${weights.agreementRate}, ` +
        `entropyConfidence=${weights.entropyConfidence}, ` +
        `varianceConfidence=${weights.varianceConfidence}, ` +
        `retryConfidence=${weights.retryConfidence}, ` +
        `verificationDepth=${weights.verificationDepth}` +
        (weights.bayesianPosterior !== undefined
          ? `, bayesianPosterior=${weights.bayesianPosterior}`
          : ""),
    );
  }
}

/**
 * Get weights for a preset, with optional overrides.
 *
 * @param preset - The preset to use
 * @param overrides - Optional partial weights to override preset values
 * @returns Complete weights with overrides applied
 *
 * @example
 * ```typescript
 * // Use consensus preset
 * const weights = getPresetWeights('consensus');
 *
 * // Use consensus but bump agreement rate
 * const custom = getPresetWeights('consensus', { agreementRate: 0.5 });
 * ```
 */
export function getPresetWeights(
  preset: ConfidencePreset,
  overrides?: Partial<ConfidenceWeights>,
): ConfidenceWeights {
  const baseWeights = WEIGHT_PRESETS[preset];

  if (!overrides) {
    return baseWeights;
  }

  const mergedWeights: ConfidenceWeights = {
    ...baseWeights,
    ...overrides,
  };

  // Re-validate after merge
  validateWeights(mergedWeights);

  return mergedWeights;
}

/**
 * Normalize weights to sum to 1.0.
 *
 * @param weights - Partial weights (may not sum to 1.0)
 * @returns Normalized weights that sum to 1.0
 *
 * @remarks
 * Useful when you want to specify relative weights without
 * manually ensuring they sum to 1.0.
 *
 * @example
 * ```typescript
 * // These don't sum to 1.0, but will be normalized
 * const normalized = normalizeWeights({
 *   agreementRate: 3,
 *   entropyConfidence: 2,
 *   varianceConfidence: 1,
 *   retryConfidence: 2,
 *   verificationDepth: 2,
 * });
 * // Result: { agreementRate: 0.3, entropyConfidence: 0.2, ... }
 * ```
 */
export function normalizeWeights(
  weights: ConfidenceWeights,
): ConfidenceWeights {
  const sum =
    weights.agreementRate +
    weights.entropyConfidence +
    weights.varianceConfidence +
    weights.retryConfidence +
    weights.verificationDepth +
    (weights.bayesianPosterior ?? 0);

  if (sum === 0) {
    throw new Error("Cannot normalize weights that sum to zero");
  }

  return {
    agreementRate: weights.agreementRate / sum,
    entropyConfidence: weights.entropyConfidence / sum,
    varianceConfidence: weights.varianceConfidence / sum,
    retryConfidence: weights.retryConfidence / sum,
    verificationDepth: weights.verificationDepth / sum,
    bayesianPosterior:
      weights.bayesianPosterior !== undefined
        ? weights.bayesianPosterior / sum
        : undefined,
  };
}
