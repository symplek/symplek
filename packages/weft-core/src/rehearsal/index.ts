/**
 * @fileoverview Rehearsal Mode exports
 * @description Barrel exports for deterministic record/replay
 * @module weft-core/rehearsal
 * @since 1.0.0
 *
 * 📝 BUILD[01.04, 02.05, 03.07, 04.08]: Barrel exports for all epics
 */

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

export type {
  AgentPayload,
  Checkpoint,
  CheckpointPayload,
  ConsensusVotePayload,
  Divergence,
  ErrorPayload,
  ExecutionTrace,
  // Payload types
  LLMCallPayload,
  LLMResponsePayload,
  OperatorPayload,
  // Config types
  RecorderOptions,
  // Result types
  RehearsalResult,
  ReplayerOptions,
  ReplayResult,
  TraceEvent,
  TraceEventPayload,
  TraceEventType,
  TraceMetadata,
  // Core types
  VectorClock,
} from "./types";
// Constants
// Error types
export {
  ReplayDivergenceError,
  TRACE_SCHEMA_VERSION,
  TraceVersionError,
} from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// VECTOR CLOCK
// ─────────────────────────────────────────────────────────────────────────────

export {
  areConcurrent,
  compareClock,
  // Pure functions
  createVectorClock,
  happensBefore,
  incrementClock,
  mergeClock,
  // Class
  VectorClockManager,
} from "./vectorClock";

// ─────────────────────────────────────────────────────────────────────────────
// SCHEDULER
// ─────────────────────────────────────────────────────────────────────────────

export {
  DependencyScheduler,
  findDependents,
  groupByAgent,
  sortByTimestamp,
} from "./scheduler";

// ─────────────────────────────────────────────────────────────────────────────
// INTERCEPTOR
// ─────────────────────────────────────────────────────────────────────────────

export type {
  InterceptorProvider,
  InterceptorRecorder,
  LLMCallConfig,
  LLMCallResponse,
  RecordedLLMCall,
} from "./interceptor";

export { RecordingLLMInterceptor, ReplayLLMInterceptor } from "./interceptor";

// ─────────────────────────────────────────────────────────────────────────────
// RECORDER
// ─────────────────────────────────────────────────────────────────────────────

export { TraceRecorder } from "./recorder";

// ─────────────────────────────────────────────────────────────────────────────
// STORAGE
// ─────────────────────────────────────────────────────────────────────────────

export type {
  StorageOptions,
  TraceFileExtension,
  TraceFileInfo,
} from "./storage";

export {
  createStorage,
  DEFAULT_STORAGE_PATH,
  FileStorage,
  loadTrace,
  saveTrace,
} from "./storage";

// ─────────────────────────────────────────────────────────────────────────────
// CHECKPOINT
// ─────────────────────────────────────────────────────────────────────────────

export {
  CheckpointManager,
  createCheckpoint,
  restoreFromCheckpoint,
} from "./checkpoint";

// ─────────────────────────────────────────────────────────────────────────────
// REPLAYER
// ─────────────────────────────────────────────────────────────────────────────

export {
  createReplayer,
  isVersionCompatible,
  replayTrace,
  TraceReplayer,
  validateTraceVersion,
} from "./replayer";

// ─────────────────────────────────────────────────────────────────────────────
// TESTING
// ─────────────────────────────────────────────────────────────────────────────

export type { DeepEqualOptions, TestHarnessConfig } from "./testing";

export {
  assertDeterministic,
  assertEqual,
  createTestHarness,
  // Assertions
  DeterminismError,
  // Deep equality
  deepEqual,
  diffPath,
  // Matchers
  expectDeterministic,
  // Test harness
  TestHarness,
} from "./testing";
