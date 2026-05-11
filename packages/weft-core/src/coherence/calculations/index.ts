/**
 * @fileoverview Coherence Calculations Barrel Export
 * @description Re-exports all coherence calculation functions
 * @module weft-core/coherence/calculations
 * @since 2.1.0
 *
 * 📝 BUILD[STORY-01.05]: Barrel export for calculations
 */

// ─── COMPOSITE COHERENCE ─────────────────────────────────────────────────────
export {
  calculateCompositeCoherence,
  meetsCoherenceThreshold,
  quickCoherence,
} from "./compositeCoherence";

// ─── ENTROPY COHERENCE ───────────────────────────────────────────────────────
export {
  calculateEntropyCoherence,
  calculateEntropyCoherenceFromProbabilities,
  type EntropyCoherenceResult,
  shannonEntropy,
} from "./entropyCoherence";
// ─── VARIANCE COHERENCE ──────────────────────────────────────────────────────
export {
  calculateVarianceCoherence,
  calculateVarianceCoherenceFromConfidences,
  simpleVariance,
  type VarianceCoherenceResult,
} from "./varianceCoherence";
