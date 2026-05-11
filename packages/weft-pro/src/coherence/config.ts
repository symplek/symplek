/**
 * @fileoverview Coherence Configuration
 * @description Default weights, thresholds, and presets for coherence calculations
 * @module weft-core/coherence/config
 * @since 2.1.0
 *
 * 📝 BUILD[STORY-01.02]: Configuration constants for coherence module
 */

import type {
  CoherencePreset,
  CoherenceThresholds,
  CoherenceWeights,
} from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// DEFAULT WEIGHTS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Default weights for coherence composite calculation.
 *
 * @remarks
 * These weights are based on the relative importance and reliability of each signal:
 * - Agreement (40%): Most direct measure of consensus
 * - Variance (25%): Confidence consistency indicates conviction alignment
 * - Entropy (15%): Decision distribution shows polarization
 * - Convergence (15%): Iterative refinement signals quality
 * - Stigmergy (5%): Future pheromone trail signal (placeholder)
 *
 * Weights sum to 1.0 for interpretable composite scores.
 */
export const DEFAULT_COHERENCE_WEIGHTS: CoherenceWeights = {
  agreement: 0.4,
  variance: 0.25,
  entropy: 0.15,
  convergence: 0.15,
  stigmergy: 0.05,
};

// ─────────────────────────────────────────────────────────────────────────────
// THRESHOLDS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Threshold values for coherence presets.
 *
 * @remarks
 * - Critical (0.95): Near-unanimous agreement required for irreversible decisions
 * - High-stakes (0.80): Strong consensus for important decisions
 * - Standard (0.70): Reasonable consensus for normal operations
 * - Byzantine (0.67): BFT minimum - 2/3 + 1 rule for fault tolerance
 */
export const COHERENCE_THRESHOLDS: CoherenceThresholds = {
  critical: 0.95,
  highStakes: 0.8,
  standard: 0.7,
  byzantine: 0.67,
};

/**
 * Map of preset names to threshold values.
 */
export const COHERENCE_PRESETS: Record<CoherencePreset, number> = {
  critical: COHERENCE_THRESHOLDS.critical,
  highStakes: COHERENCE_THRESHOLDS.highStakes,
  standard: COHERENCE_THRESHOLDS.standard,
  byzantine: COHERENCE_THRESHOLDS.byzantine,
};

// ─────────────────────────────────────────────────────────────────────────────
// ALGORITHM VERSION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Current algorithm version for audit trail.
 * Increment on formula changes for reproducibility.
 */
export const COHERENCE_ALGORITHM_VERSION = "2.1.0";

// ─────────────────────────────────────────────────────────────────────────────
// UTILITY FUNCTIONS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Resolve threshold from options.
 * Preset takes precedence over explicit threshold.
 *
 * @param options - Coherence options with optional preset or threshold
 * @param defaultPreset - Default preset if neither provided (default: 'standard')
 * @returns Resolved threshold value
 */
export function resolveThreshold(
  options: { threshold?: number; preset?: CoherencePreset },
  defaultPreset: CoherencePreset = "standard",
): number {
  if (options.preset) {
    return COHERENCE_PRESETS[options.preset];
  }
  if (options.threshold !== undefined) {
    return options.threshold;
  }
  return COHERENCE_PRESETS[defaultPreset];
}

/**
 * Merge partial weights with defaults.
 *
 * @param partial - Partial weight overrides
 * @returns Complete weights with defaults for unspecified values
 */
export function mergeWeights(
  partial?: Partial<CoherenceWeights>,
): CoherenceWeights {
  if (!partial) {
    return { ...DEFAULT_COHERENCE_WEIGHTS };
  }
  return {
    agreement: partial.agreement ?? DEFAULT_COHERENCE_WEIGHTS.agreement,
    variance: partial.variance ?? DEFAULT_COHERENCE_WEIGHTS.variance,
    entropy: partial.entropy ?? DEFAULT_COHERENCE_WEIGHTS.entropy,
    convergence: partial.convergence ?? DEFAULT_COHERENCE_WEIGHTS.convergence,
    stigmergy: partial.stigmergy ?? DEFAULT_COHERENCE_WEIGHTS.stigmergy,
  };
}

/**
 * Validate that weights sum to approximately 1.0.
 *
 * @param weights - Weights to validate
 * @param tolerance - Acceptable deviation from 1.0 (default: 0.01)
 * @returns True if weights sum to 1.0 within tolerance
 */
export function validateWeightSum(
  weights: CoherenceWeights,
  tolerance: number = 0.01,
): boolean {
  const sum =
    weights.agreement +
    weights.variance +
    weights.entropy +
    weights.convergence +
    weights.stigmergy;
  return Math.abs(sum - 1.0) <= tolerance;
}

/**
 * Normalize weights to sum to 1.0.
 *
 * @param weights - Weights to normalize
 * @returns Normalized weights summing to 1.0
 */
export function normalizeWeights(weights: CoherenceWeights): CoherenceWeights {
  const sum =
    weights.agreement +
    weights.variance +
    weights.entropy +
    weights.convergence +
    weights.stigmergy;

  if (sum === 0) {
    // Avoid division by zero - return equal weights
    return {
      agreement: 0.2,
      variance: 0.2,
      entropy: 0.2,
      convergence: 0.2,
      stigmergy: 0.2,
    };
  }

  return {
    agreement: weights.agreement / sum,
    variance: weights.variance / sum,
    entropy: weights.entropy / sum,
    convergence: weights.convergence / sum,
    stigmergy: weights.stigmergy / sum,
  };
}

/**
 * Get preset name from threshold value.
 *
 * @param threshold - Threshold value to match
 * @returns Preset name if exact match, undefined otherwise
 */
export function getPresetFromThreshold(
  threshold: number,
): CoherencePreset | undefined {
  for (const [preset, value] of Object.entries(COHERENCE_PRESETS)) {
    if (Math.abs(value - threshold) < 0.001) {
      return preset as CoherencePreset;
    }
  }
  return undefined;
}
