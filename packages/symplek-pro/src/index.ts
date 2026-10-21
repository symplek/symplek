/**
 * @fileoverview Public API exports for @symplek/pro
 * @description Commercial license - Advanced multi-agent features.
 *
 * ⚠️ FATAL #6 FIX (2026-07-07): License validation added. All Pro exports
 * are gated behind validateLicense(). Importing this module or any Pro
 * sub-module without a valid license key will throw at module load time.
 *
 * @module @symplek/pro
 * @since 1.0.0-beta.2 — License-gated
 *
 * @remarks
 * This package provides advanced features requiring a commercial license:
 * - TaCo iterative consensus (multi-round voting)
 * - Stigmergic confidence with decay
 * - Agent antibodies (pattern detection, quarantine, learning)
 * - Trusted traveler lanes
 * - Change-Kernel (P0/P1/P2 severity classification)
 * - Solo Mechanism extensions
 * - Team coordination
 *
 * Requires @symplek/core as peer dependency.
 * Requires a valid license key set via SYMPLEK_PRO_LICENSE_KEY env var or
 * validateLicense() API call.
 */

// ═══════════════════════════════════════════════════════════════════════════════
// LICENSE GATE — FATAL #6 HARDENING (2026-07-07)
// Importing license-gate triggers requireLicense() at module scope.
// Node.js module caching ensures it only executes once even if multiple
// Pro modules import it. This import is NOT strippable by bundlers.
// ═══════════════════════════════════════════════════════════════════════════════
import "./license-gate";

// Re-export validateLicense and isProLicensed for the public barrel API
export { validateLicense, isProLicensed } from "./license-gate";

// ─────────────────────────────────────────────────────────────────────────────
// TACO CONSENSUS EXPORTS
// ─────────────────────────────────────────────────────────────────────────────

export { tacoConsensus } from "./taco";
export type {
  TaCoConsensusOptions,
  TaCoResult,
  TaCoRound,
  TaCoVote,
} from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// STIGMERGY CONFIDENCE EXPORTS
// ─────────────────────────────────────────────────────────────────────────────

export {
  ConfidentStigmergyLayer,
  createConfidentPheromone,
} from "./stigmergy";
export type {
  ConfidenceDepositOptions,
  ConfidenceSenseOptions,
  ConfidentPheromone,
} from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// ANTIBODY EXPORTS
// ─────────────────────────────────────────────────────────────────────────────

export {
  AntibodyRegistry,
  defaultAntibodyRegistry,
} from "./antibodies";
export type {
  AntibodyScanResult,
  BadOutputPattern,
  PatternMatcher,
} from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// OBSERVABILITY EXPORTS — MOVED TO @symplek/core (Phase 0 of opencore release)
// ─────────────────────────────────────────────────────────────────────────────
// `observable`, `getTraces`, `createOperatorSpan`, `trackCost`, `trackError`,
// `configureObservability`, `getObservabilityConfig`, `clearTraces`, and the
// `TraceEntry`, `TraceCollector`, `Span`, `ObservabilityOptions`, and
// `ObservabilityVerbosity` types are now exported from @symplek/core.
// Import from "@symplek/core" instead.

// ─────────────────────────────────────────────────────────────────────────────
// TRUST EXPORTS
// ─────────────────────────────────────────────────────────────────────────────

export {
  defaultTrustRegistry,
  getScanDepthForTrust,
  TrustRegistry,
} from "./trust";
export type {
  TrustGrant,
  TrustLevel,
} from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// COHERENCE MODULE EXPORTS (Wave 3 — moved from @symplek/core)
// ─────────────────────────────────────────────────────────────────────────────

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
  EntropyCoherenceResult,
  HasContributions,
  HasVotes,
  VarianceCoherenceResult,
} from "./coherence";
export {
  COHERENCE_ALGORITHM_VERSION,
  COHERENCE_PRESETS,
  COHERENCE_THRESHOLDS,
  calculateCompositeCoherence,
  // Note: shannonEntropy already exported from confidence module below
  calculateEntropyCoherence,
  calculateEntropyCoherenceFromProbabilities,
  calculateVarianceCoherence,
  calculateVarianceCoherenceFromConfidences,
  // Note: simpleVariance already exported from confidence module below
  DEFAULT_COHERENCE_WEIGHTS,
  getPresetFromThreshold,
  hasContributions,
  hasVotes,
  meetsCoherenceThreshold,
  mergeWeights,
  normalizeCoherenceWeights,
  quickCoherence,
  resolveThreshold,
  validateWeightSum,
} from "./coherence";

// ─────────────────────────────────────────────────────────────────────────────
// CONFIDENCE MODULE EXPORTS (Wave 3 — moved from @symplek/core)
// ─────────────────────────────────────────────────────────────────────────────

export type {
  ConfidenceCalculationOptions,
  ConfidenceInput,
  ConfidenceMetadata,
  ConfidencePreset,
  ConfidenceSignal,
  ConfidenceThresholds,
  ConfidenceTier,
  ConfidenceWeights,
  ObjectiveConfidence,
  TierName,
} from "./confidence";
export {
  CONFIDENCE_THRESHOLDS,
  calculateAgreementRate,
  calculateEntropyConfidence,
  calculateObjectiveConfidence,
  calculateRetryConfidence,
  calculateVarianceConfidence,
  calculateVerificationDepthConfidence,
  DEFAULT_WEIGHTS,
  getConfidenceTier,
  getPresetWeights,
  isUnanimous,
  meetsThreshold,
  normalizeWeights,
  quickConfidence,
  shannonEntropy,
  simpleAgreementRate,
  simpleVariance,
  validateWeights,
  WEIGHT_PRESETS,
} from "./confidence";

// ─────────────────────────────────────────────────────────────────────────────
// INTERVIEW MODULE EXPORTS (Wave 3 — moved from @symplek/core)
// ─────────────────────────────────────────────────────────────────────────────

export type {
  Answer,
  Assumption,
  ClarityScore,
  EvaluatorAgent,
  ExtractorAgent,
  InterviewConfig,
  InterviewHandlers,
  InterviewOptions,
  InterviewPending,
  InterviewProgress,
  InterviewResult,
  InterviewState,
  Question,
  QuestionerAgent,
  QuestionOption,
} from "./interview";
export {
  analyzeSchema,
  createConductComputation,
  createDefaultEvaluator,
  createDefaultExtractor,
  createDefaultQuestioner,
  createInterviewComputation,
  Interview,
} from "./interview";

// ─────────────────────────────────────────────────────────────────────────────
// SOLO MODULE EXPORTS (Wave 3 — moved from @symplek/core)
// ─────────────────────────────────────────────────────────────────────────────

export * from "./solo";

// ─────────────────────────────────────────────────────────────────────────────
// TEAMS MODULE EXPORTS (Wave 3 — moved from @symplek/core)
// ─────────────────────────────────────────────────────────────────────────────

export type { TeamConfig, TeamMode, TeamResult } from "./teams";
export { Team, TeamRegistry, teams } from "./teams";

// ─────────────────────────────────────────────────────────────────────────────
// CONTRACT EXPORTS (Wave 3 — moved from @symplek/core)
// ─────────────────────────────────────────────────────────────────────────────

export type { ContractMismatch, ContractOptions } from "./contract";
export { ContractError, defineContract } from "./contract";

// ─────────────────────────────────────────────────────────────────────────────
// CHANGE-KERNEL EXPORTS (Wave 3 — moved from @symplek/core)
// ─────────────────────────────────────────────────────────────────────────────

export * from "./change-kernel";

// ─────────────────────────────────────────────────────────────────────────────
// CONFIDENCE PRESET TYPE (re-export from local)
// ─────────────────────────────────────────────────────────────────────────────
// Note: shannonEntropy and simpleVariance are also exported from coherence above
// normalizeWeights has an alias in coherence (normalizeCoherenceWeights)

// ─────────────────────────────────────────────────────────────────────────────
// DEBATE / DIALECTIC TYPES (Wave 3 — moved from @symplek/core)
// ─────────────────────────────────────────────────────────────────────────────

export type {
  AdvisorAgent,
  CoherenceOptions,
  CoherenceResult,
  ConvergeContribution,
  ConvergentAgent,
  ConvergeOptions,
  ConvergeResult,
  Critique,
  DebateAgent,
  DebateOptions,
  DebateResult,
  DialecticOptions,
  DialecticResult,
  LeaderAgent,
  SynthesisResponse,
  ThesisResponse,
} from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// PREMIUM OPERATOR FACTORIES (Wave 3 — moved from @symplek/core)
// ─────────────────────────────────────────────────────────────────────────────

export {
  CoherenceError,
  createCoherenceComputation,
  createDebateComputation,
  createDialecticComputation,
  createSoloComputation,
  extractSignals,
} from "./operators";

// ─────────────────────────────────────────────────────────────────────────────
// VERSION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Package version.
 */
export const VERSION = "1.0.0-beta.1";
