/**
 * @fileoverview Confidence Calculations Barrel Export
 * @description Re-exports all calculation functions for the confidence module
 * @module @symplek/core/confidence/calculations
 * @since 2.0.0
 *
 * 📝 BUILD[01.09]: Barrel exports for calculation functions
 */

// ─────────────────────────────────────────────────────────────────────────────
// TIER 1: IMMEDIATE (Agreement Rate)
// ─────────────────────────────────────────────────────────────────────────────

export {
  type AgreementRateResult,
  calculateAgreementRate,
  isUnanimous,
  simpleAgreementRate,
} from "./agreementRate";

// ─────────────────────────────────────────────────────────────────────────────
// TIER 2A: STATISTICAL (Entropy)
// ─────────────────────────────────────────────────────────────────────────────

export {
  calculateEntropyConfidence,
  countsToEntropyConfidence,
  type EntropyConfidenceResult,
  shannonEntropy,
} from "./entropyConfidence";

// ─────────────────────────────────────────────────────────────────────────────
// TIER 2B: STATISTICAL (Variance)
// ─────────────────────────────────────────────────────────────────────────────

export {
  calculateVarianceConfidence,
  calculateVarianceConfidenceFromVotes,
  extractConfidencesFromVotes,
  populationVariance,
  simpleVariance,
  type VarianceConfidenceResult,
} from "./varianceConfidence";

// ─────────────────────────────────────────────────────────────────────────────
// TIER 3: BEHAVIORAL (Retry & Verification)
// ─────────────────────────────────────────────────────────────────────────────

export {
  calculateRetryConfidence,
  calculateVerificationDepthConfidence,
  type RetryConfidenceOptions,
  type RetryConfidenceResult,
  type RetryDecayModel,
  simpleRetryConfidence,
} from "./retryConfidence";

// ─────────────────────────────────────────────────────────────────────────────
// COMPOSITE
// ─────────────────────────────────────────────────────────────────────────────

export {
  calculateObjectiveConfidence,
  getConfidenceTier,
  meetsThreshold,
  quickConfidence,
} from "./composite";
