/**
 * @fileoverview Public API exports for @symplek/core
 * @description MIT-licensed free-tier package — full public surface
 * @module @symplek/core
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
  SymplekErrorCode,
  SymplekErrorDetail,
  SymplekErrorOptions,
} from "./errors";
export { CompensationError, IdempotencyStoreWriteError, SymplekError } from "./errors";
export type {
  InterviewConfig,
  InterviewOptions,
  InterviewResult,
} from "./interview";
// ─── Interview ───────────────────────────────────────────────────────────────
export { Interview } from "./interview";
// ─── Idempotency ─────────────────────────────────────────────────────────────
export {
  defaultIdempotencyStore,
  IdempotencyError,
  InMemoryIdempotencyStore,
} from "./idempotency";
export type {
  IdempotencyConfig,
  IdempotencyStore,
  IdempotencyStrategy,
} from "./idempotency";
// ─── Observability (Free Tier — moved from @symplek/pro) ────────────────────────
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
// ─── OpenTelemetry Export (additive — optional @opentelemetry/* peers) ───────
export {
  configureOpenTelemetry,
  exportTraces,
  genAiSpanAttributes,
  type OpenTelemetryOptions,
  type OtelExportResult,
  passthroughSpanAttributes,
  shutdownOpenTelemetry,
} from "./otel";
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
// ─── Solo Mechanism (free tier — basic solo; Pro tier extends in @symplek/pro) ───
// These are the building blocks. For TaCo, trust registry, antibodies, change-kernel,
// install @symplek/pro and call validateLicense().
export {
  // Config
  getPresetFromConfig,
  mergeConfig,
  resolvePreset,
  SOLO_DEFAULTS,
  SOLO_PRESETS,
  validateConfig,
  // Decision
  calculateMargins,
  decisionFromSignals,
  formatDecision,
  meetsThresholds,
  shouldActSolo,
  // Lock
  acquireLock,
  cleanupExpiredLocks,
  clearAllLocks,
  defaultLockManager,
  extendLock,
  forceReleaseLock,
  getActiveLocks,
  getLockHolder,
  InMemoryLockManager,
  isLockHeld,
  releaseLock,
  // Rollback
  clearAllCheckpoints,
  clearOldCheckpoints,
  composeRollbackHandlers,
  createCheckpoint,
  createObjectRollbackHandler,
  executeWithRollback,
  getActiveCheckpoints,
  getCheckpoint,
  removeCheckpoint,
  withValidation,
  // Transaction Log
  clearAllTransactions,
  commitTransaction,
  createTransaction,
  defaultTransactionLogManager,
  getPendingTransactions,
  getTransaction,
  getTransactionStats,
  getTransactionsByAgent,
  InMemoryTransactionLogManager,
  pruneTransactions,
  queryTransactions,
  rollbackTransaction,
} from "./solo";
// ─── Solo Types ───────────────────────────────────────────────────────────────
export type {
  Checkpoint,
  ExtractedSignals,
  LockAcquisitionResult,
  LockEntry,
  LockManager,
  RollbackHandler,
  RollbackOptions,
  RollbackResult,
  SignalExtractionConfig,
  SoloConfig,
  SoloDecision,
  SoloPreset,
  SoloResult,
  TransactionEntry,
  TransactionLogManager,
  TransactionQuery,
  TransactionStatus,
} from "./solo";
// ─── Solo Error Classes ───────────────────────────────────────────────────
export {
  LockAcquisitionError,
  RollbackError,
  SoloBlockedError,
} from "./solo";
export type { StreamOptions } from "./streaming";
export type { TeamConfig, TeamMode, TeamResult } from "./teams";
// ─── Teams (free tier — basic team; Pro tier extends in @symplek/pro) ────────────
export { Team, TeamRegistry, teams } from "./teams";
// ─── Trace ───────────────────────────────────────────────────────────────────
export type { Trace, TraceCallback, TraceRedactor } from "./trace";
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
// ─── Trust / TrackedResult (unforgeable — marker is module-private) ──────────
export { createTrackedResult, isTrackedResult, unwrapTrackedResult, extractTrackedConfidence } from "./trust";
// Durable execution (CR-403) is published on the `@symplek/core/store` subpath,
// matching every other Wave 5 capability (`./uncertainty`, `./rehearsal`,
// `./agent`). Keeping new capability surface off the root barrel is what lets
// boundaryTest and exportCount stay meaningful as the framework grows.
export { isTracked, unwrapTracked } from "./utils";
// ─── Version ─────────────────────────────────────────────────────────────────
export { VERSION } from "./version";
