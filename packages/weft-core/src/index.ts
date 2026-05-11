/**
 * @fileoverview Public API exports for weft-core
 * @description MIT-licensed free-tier package — full public surface
 * @module weft-core
 * @since 1.0.0-beta.1
 * @rules .cursor/rules/patterns/029-file-header-contracts.mdc
 */

// ─── Core AgentUnit ───────────────────────────────────────────────────────────
export type { AgentComputation, AgentUnitMetadata } from "./AgentUnit";
export { AgentUnit } from "./AgentUnit";
// ─── AI Types (browser-safe, type-only) ──────────────────────────────────────
export type { AIOptions, AIPrompt, AIResult } from "./ai";
// ─── Coherence ───────────────────────────────────────────────────────────────
export {
  COHERENCE_ALGORITHM_VERSION,
  COHERENCE_PRESETS,
  COHERENCE_THRESHOLDS,
  calculateCompositeCoherence,
  calculateEntropyCoherence,
  calculateVarianceCoherence,
  DEFAULT_COHERENCE_WEIGHTS,
  quickCoherence,
} from "./coherence";
// ─── Confidence ──────────────────────────────────────────────────────────────
export {
  CONFIDENCE_THRESHOLDS,
  calculateAgreementRate,
  calculateEntropyConfidence,
  calculateObjectiveConfidence,
  calculateRetryConfidence,
  calculateVarianceConfidence,
  DEFAULT_WEIGHTS,
  quickConfidence,
  WEIGHT_PRESETS,
} from "./confidence";

// ─── Context ─────────────────────────────────────────────────────────────────
export { createContext } from "./context";
export type { ContractMismatch, ContractOptions } from "./contract";
// ─── Contract Validation ─────────────────────────────────────────────────────
export { ContractError, defineContract } from "./contract";
// ─── Errors ──────────────────────────────────────────────────────────────────
export type {
  ErrorCode,
  WeftErrorCode,
  WeftErrorDetail,
  WeftErrorOptions,
} from "./errors";
export { WeftError } from "./errors";
export type {
  InterviewConfig,
  InterviewOptions,
  InterviewResult,
} from "./interview";
// ─── Interview ───────────────────────────────────────────────────────────────
export { Interview } from "./interview";
// ─── Observability (Free Tier — moved from weft-pro) ────────────────────────
export {
  clearTraces,
  configureObservability,
  createOperatorSpan,
  getObservabilityConfig,
  getTraces,
  observable,
  trackCost,
  trackError,
} from "./observability";
// ─── CoherenceError + createSoloComputation (operators.ts) ───────────────────
export { CoherenceError, createSoloComputation } from "./operators";
// ─── Provider ────────────────────────────────────────────────────────────────
export { resolveModelFromContext } from "./providers/auto";
export type { AIMessage, Provider } from "./providers/interface";
// ─── Rehearsal ───────────────────────────────────────────────────────────────
export {
  CheckpointManager,
  DependencyScheduler,
  DeterminismError,
  FileStorage,
  RecordingLLMInterceptor,
  ReplayDivergenceError,
  ReplayLLMInterceptor,
  TestHarness,
  TRACE_SCHEMA_VERSION,
  TraceRecorder,
  TraceReplayer,
  TraceVersionError,
  VectorClockManager,
} from "./rehearsal";
// ─── Solo Mechanism ──────────────────────────────────────────────────────────
export {
  defaultLockManager,
  defaultTransactionLogManager,
  InMemoryLockManager,
  InMemoryTransactionLogManager,
  SOLO_DEFAULTS,
  SOLO_PRESETS,
  shouldActSolo,
} from "./solo";
export type { StreamOptions } from "./streaming";
export type { TeamConfig, TeamMode, TeamResult } from "./teams";
// ─── Teams ───────────────────────────────────────────────────────────────────
export { Team, TeamRegistry, teams } from "./teams";
// ─── Trace ───────────────────────────────────────────────────────────────────
export type { Trace, TraceCallback } from "./trace";
// ─── Source Tracking ─────────────────────────────────────────────────────────
// ─── Consensus (single-round, MIT) ───────────────────────────────────────────
// ─── Resilience ──────────────────────────────────────────────────────────────
export type {
  AgentContext,
  ConsensusOptions,
  ConsensusResult,
  ObservabilityOptions,
  ObservabilityVerbosity,
  ResultSource,
  RetryOptions,
  RunOptionsWithTrust,
  SourceTrackingOptions,
  Span,
  TraceCollector,
  TraceEntry,
  TrackedResult,
  TrustMode,
  Vote,
  VoteInput,
} from "./types";
export { TRACKED_MARKER } from "./types";
export { isTracked, unwrapTracked } from "./utils";
// ─── Version ─────────────────────────────────────────────────────────────────
export { VERSION } from "./version";
