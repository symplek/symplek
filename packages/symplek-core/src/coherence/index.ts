/**
 * @fileoverview Coherence Module Barrel Export
 * @description Public API for ensemble coherence measurement
 * @module @symplek/core/coherence
 * @since 2.1.0
 *
 * 📝 BUILD[STORY-01.05]: Main barrel export for coherence module
 *
 * @remarks
 * The coherence module provides mathematical measurement of ensemble alignment.
 * It calculates multiple coherence signals and combines them into a composite score.
 *
 * @example
 * ```typescript
 * import {
 *   calculateCompositeCoherence,
 *   COHERENCE_THRESHOLDS,
 *   type EnsembleCoherence,
 * } from '@symplek/core/coherence';
 *
 * const coherence = calculateCompositeCoherence({ votes: consensusResult.votes });
 * if (coherence.composite >= COHERENCE_THRESHOLDS.standard) {
 *   // Sufficient coherence
 * }
 * ```
 */

// ─── CALCULATIONS ────────────────────────────────────────────────────────────
export {
  // Composite
  calculateCompositeCoherence,
  // Entropy
  calculateEntropyCoherence,
  calculateEntropyCoherenceFromProbabilities,
  // Variance
  calculateVarianceCoherence,
  calculateVarianceCoherenceFromConfidences,
  type EntropyCoherenceResult,
  meetsCoherenceThreshold,
  quickCoherence,
  shannonEntropy,
  simpleVariance,
  type VarianceCoherenceResult,
} from "./calculations";
// ─── CONFIG ──────────────────────────────────────────────────────────────────
export {
  COHERENCE_ALGORITHM_VERSION,
  COHERENCE_PRESETS,
  COHERENCE_THRESHOLDS,
  DEFAULT_COHERENCE_WEIGHTS,
  getPresetFromThreshold,
  mergeWeights,
  normalizeWeights,
  resolveThreshold,
  validateWeightSum,
} from "./config";
// ─── TYPES ───────────────────────────────────────────────────────────────────
export type {
  CoherenceCalculationOptions,
  CoherenceInput,
  CoherenceMetadata,
  CoherenceMethod,
  CoherencePreset,
  CoherenceSignal,
  CoherenceThresholds,
  CoherenceWeights,
  EnsembleCoherence,
  HasContributions,
  HasVotes,
} from "./types";
// ─── TYPE GUARDS ─────────────────────────────────────────────────────────────
export { hasContributions, hasVotes } from "./types";
