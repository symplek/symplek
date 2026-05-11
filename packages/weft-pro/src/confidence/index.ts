/**
 * @fileoverview Objective Confidence Module
 * @description Mathematically computed confidence scoring for multi-agent AI
 * @module weft-core/confidence
 * @since 2.0.0
 *
 * 📝 BUILD[01.10]: Barrel exports for confidence module
 *
 * @remarks
 * This module provides objective confidence scoring that replaces
 * unreliable LLM self-reported confidence with mathematically
 * computed values based on observable behavior.
 *
 * Key concepts:
 * - **Objective Confidence**: Computed from behavior, not self-report
 * - **Tiered System**: 4 tiers from simple (agreement) to complex (Bayesian)
 * - **Composite Score**: Weighted combination of all available signals
 * - **Full Audit Trail**: Every calculation is traceable to its inputs
 *
 * @example
 * ```typescript
 * import {
 *   calculateObjectiveConfidence,
 *   DEFAULT_WEIGHTS,
 *   CONFIDENCE_THRESHOLDS,
 * } from 'weft-core/confidence';
 *
 * // Calculate confidence from consensus votes
 * const result = calculateObjectiveConfidence({
 *   votes: consensusResult.votes,
 *   retryCount: 0,
 * });
 *
 * // Use thresholds for decision routing
 * if (result.composite > CONFIDENCE_THRESHOLDS.high) {
 *   // High confidence - safe to auto-approve
 * } else if (result.composite < CONFIDENCE_THRESHOLDS.low) {
 *   // Low confidence - require human review
 * }
 * ```
 */

// ─────────────────────────────────────────────────────────────────────────────
// TYPE EXPORTS
// ─────────────────────────────────────────────────────────────────────────────

export type {
  ConfidenceCalculationOptions,
  // Input types
  ConfidenceInput,
  ConfidenceMetadata,
  ConfidencePreset,
  ConfidenceSignal,
  ConfidenceThresholds,
  // Tier types
  ConfidenceTier,
  // Configuration types
  ConfidenceWeights,
  // Core result types
  ObjectiveConfidence,
  TierName,
} from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// CONFIG EXPORTS
// ─────────────────────────────────────────────────────────────────────────────

export {
  ALGORITHM_VERSION,
  // Thresholds
  CONFIDENCE_THRESHOLDS,
  DEFAULT_MAX_RETRIES,
  DEFAULT_MAX_VARIANCE,
  // Constants
  DEFAULT_RETRY_LAMBDA,
  // Default weights
  DEFAULT_WEIGHTS,
  getPresetWeights,
  normalizeWeights,
  RETRY_CONFIDENCE_FLOOR,
  // Validation utilities
  validateWeights,
  // Presets
  WEIGHT_PRESETS,
} from "./config";

// ─────────────────────────────────────────────────────────────────────────────
// CALCULATION EXPORTS
// ─────────────────────────────────────────────────────────────────────────────

// Tier 1: Agreement Rate
export {
  type AgreementRateResult,
  calculateAgreementRate,
  isUnanimous,
  simpleAgreementRate,
} from "./calculations/agreementRate";
// Composite
export {
  calculateObjectiveConfidence,
  getConfidenceTier,
  meetsThreshold,
  quickConfidence,
} from "./calculations/composite";
// Tier 2a: Entropy
export {
  calculateEntropyConfidence,
  countsToEntropyConfidence,
  type EntropyConfidenceResult,
  shannonEntropy,
} from "./calculations/entropyConfidence";

// Tier 3: Behavioral
export {
  calculateRetryConfidence,
  calculateVerificationDepthConfidence,
  type RetryConfidenceOptions,
  type RetryConfidenceResult,
  type RetryDecayModel,
  simpleRetryConfidence,
} from "./calculations/retryConfidence";
// Tier 2b: Variance
export {
  calculateVarianceConfidence,
  calculateVarianceConfidenceFromVotes,
  extractConfidencesFromVotes,
  populationVariance,
  simpleVariance,
  type VarianceConfidenceResult,
} from "./calculations/varianceConfidence";
