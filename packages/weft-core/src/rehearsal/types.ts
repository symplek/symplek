/**
 * @fileoverview Core types for Rehearsal Mode
 * @description Deterministic record/replay types for multi-agent AI testing
 * @module weft-core/rehearsal/types
 * @since 1.0.0
 *
 * 📝 BUILD[01.01]: Core types for Rehearsal Mode
 */

// ─────────────────────────────────────────────────────────────────────────────
// VECTOR CLOCK TYPES
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Vector clock for causal ordering across agents.
 * Maps agent IDs to their logical clock values.
 *
 * @example
 * ```typescript
 * const clock: VectorClock = {
 *   'agent-1': 3,
 *   'agent-2': 1,
 *   'agent-3': 5
 * };
 * ```
 */
export type VectorClock = Record<string, number>;

// ─────────────────────────────────────────────────────────────────────────────
// TRACE EVENT TYPES
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Discriminated union of trace event types.
 */
export type TraceEventType =
  | "llm_call"
  | "llm_response"
  | "operator"
  | "checkpoint"
  | "agent_start"
  | "agent_end"
  | "consensus_vote"
  | "error";

/**
 * Payload for LLM call events.
 */
export interface LLMCallPayload {
  readonly model: string;
  readonly prompt?: string; // Optional - excluded by default for privacy
  readonly promptHash: string; // Always included for comparison
  readonly temperature?: number;
  readonly maxTokens?: number;
  readonly systemPrompt?: string;
}

/**
 * Payload for LLM response events.
 */
export interface LLMResponsePayload {
  readonly model: string;
  readonly response?: string; // Optional - excluded by default for privacy
  readonly responseHash: string; // Always included for comparison
  readonly tokensUsed?: number;
  readonly finishReason?: string;
  readonly latencyMs: number;
}

/**
 * Payload for operator events (map, flatMap, etc.).
 */
export interface OperatorPayload {
  readonly operator: string;
  readonly inputHash?: string;
  readonly outputHash?: string;
  readonly durationMs: number;
}

/**
 * Payload for checkpoint events.
 */
export interface CheckpointPayload {
  readonly checkpointId: string;
  readonly stateHash: string;
  readonly stateSizeBytes: number;
}

/**
 * Payload for agent start/end events.
 */
export interface AgentPayload {
  readonly agentId: string;
  readonly operatorChain?: readonly string[];
}

/**
 * Payload for consensus vote events.
 */
export interface ConsensusVotePayload {
  readonly voterId: string;
  readonly approved: boolean;
  readonly confidence: number;
  readonly reasoning?: string;
}

/**
 * Payload for error events.
 */
export interface ErrorPayload {
  readonly code: string;
  readonly message: string;
  readonly stack?: string;
}

/**
 * Union of all payload types.
 */
export type TraceEventPayload =
  | LLMCallPayload
  | LLMResponsePayload
  | OperatorPayload
  | CheckpointPayload
  | AgentPayload
  | ConsensusVotePayload
  | ErrorPayload;

/**
 * A single event in the execution trace.
 */
export interface TraceEvent {
  /** Unique identifier for this event */
  readonly id: string;

  /** Type of event for discrimination */
  readonly type: TraceEventType;

  /** Agent that produced this event */
  readonly agentId: string;

  /** Wall-clock timestamp (ms since epoch) */
  readonly timestamp: number;

  /** Vector clock at time of event */
  readonly vectorClock: VectorClock;

  /** Event-specific payload */
  readonly payload: TraceEventPayload;

  /** SHA-256 hash for integrity verification */
  readonly hash: string;

  /** Duration in milliseconds (for timed events) */
  readonly durationMs?: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// CHECKPOINT TYPES
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A checkpoint capturing agent state for partial replay.
 */
export interface Checkpoint {
  /** Unique identifier for this checkpoint */
  readonly id: string;

  /** Vector clock at time of checkpoint */
  readonly vectorClock: VectorClock;

  /** Serialized state (JSON-safe) */
  readonly state: unknown;

  /** Wall-clock timestamp */
  readonly timestamp: number;

  /** Hash of serialized state */
  readonly stateHash: string;

  /** Index in events array of corresponding checkpoint event */
  readonly eventIndex: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// TRACE METADATA TYPES
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Metadata about the execution trace.
 */
export interface TraceMetadata {
  /** Description of the composition (e.g., "consensus([a,b,c])") */
  readonly composition: string;

  /** Number of unique agents involved */
  readonly agentCount: number;

  /** Total number of events */
  readonly eventCount: number;

  /** Total duration in milliseconds */
  readonly durationMs: number;

  /** Schema version for migration support */
  readonly schemaVersion: string;

  /** Operator chain from AgentUnit metadata */
  readonly operatorChain: readonly string[];

  /** Whether prompts were included in trace */
  readonly includesPrompts: boolean;

  /** Number of checkpoints */
  readonly checkpointCount: number;

  /**
   * DJB2 hash of finalOutput computed at record time.
   * Present on traces produced by the fixed recorder; absent on older traces.
   * Used by verifyFinalOutputIntegrity() to detect post-record tampering.
   */
  readonly outputHash?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// EXECUTION TRACE TYPES
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Current schema version for traces.
 */
export const TRACE_SCHEMA_VERSION = "1.0.0" as const;

/**
 * Complete execution trace for record/replay.
 */
export interface ExecutionTrace<T = unknown> {
  /** Unique identifier for this trace */
  readonly id: string;

  /** Schema version for migration support */
  readonly version: typeof TRACE_SCHEMA_VERSION;

  /** Start timestamp (ms since epoch) */
  readonly startTime: number;

  /** End timestamp (ms since epoch) */
  readonly endTime: number;

  /** Ordered array of events */
  readonly events: readonly TraceEvent[];

  /** Array of checkpoints for partial replay */
  readonly checkpoints: readonly Checkpoint[];

  /** Trace metadata */
  readonly metadata: TraceMetadata;

  /** Final output of the computation */
  readonly finalOutput: T;
}

// ─────────────────────────────────────────────────────────────────────────────
// CONFIGURATION TYPES
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Options for recording traces.
 */
export interface RecorderOptions {
  /** Include prompts in trace (default: false for privacy) */
  readonly includePrompts?: boolean;

  /** Patterns for redacting sensitive data */
  readonly redactPatterns?: readonly RegExp[];

  /** Custom interceptors to install */
  readonly interceptors?: readonly string[];

  /** Create checkpoints every N events (default: 100) */
  readonly checkpointInterval?: number;

  /** Storage directory (default: __traces__/) */
  readonly storagePath?: string;
}

/**
 * Options for replaying traces.
 */
export interface ReplayerOptions {
  /** Start from specific checkpoint (for partial replay) */
  readonly fromCheckpoint?: string;

  /** Stop after N events (for debugging) */
  readonly stopAfterEvents?: number;

  /** Tolerance for timing drift (ms) */
  readonly timingTolerance?: number;

  /** Callback for divergence detection */
  readonly onDivergence?: (divergence: Divergence) => void;
}

// ─────────────────────────────────────────────────────────────────────────────
// RESULT TYPES
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Result of a rehearsal (record) operation.
 */
export interface RehearsalResult<T> {
  /** The computation result */
  readonly value: T;

  /** The recorded execution trace */
  readonly trace: ExecutionTrace<T>;
}

/**
 * A divergence detected during replay.
 */
export interface Divergence {
  /** Event that diverged */
  readonly eventId: string;

  /** Expected value/hash */
  readonly expected: unknown;

  /** Actual value/hash */
  readonly actual: unknown;

  /** Severity of the divergence */
  readonly severity: "critical" | "warning" | "info";

  /** Human-readable description */
  readonly description: string;
}

/**
 * Result of a replay operation.
 */
export interface ReplayResult<T> {
  /** The replayed computation result */
  readonly value: T;

  /** Divergences detected during replay */
  readonly divergences: readonly Divergence[];

  /** Whether replay matched the original trace */
  readonly matched: boolean;

  /** Events that were replayed */
  readonly eventsReplayed: number;

  /** Total events in trace */
  readonly totalEvents: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// ERROR TYPES
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Error thrown when replay diverges from recorded trace.
 */
export class ReplayDivergenceError extends Error {
  constructor(
    message: string,
    public readonly expected: unknown,
    public readonly actual: unknown,
    public readonly eventId?: string,
  ) {
    super(message);
    this.name = "ReplayDivergenceError";
  }
}

/**
 * Error thrown when trace schema is incompatible.
 */
export class TraceVersionError extends Error {
  constructor(
    public readonly traceVersion: string,
    public readonly expectedVersion: string,
  ) {
    super(
      `Trace version ${traceVersion} is incompatible with current version ${expectedVersion}`,
    );
    this.name = "TraceVersionError";
  }
}
