/**
 * @fileoverview Trace Recorder for capturing execution traces
 * @description Records events with vector clocks, hashes, and metadata
 * @module @weft/core/rehearsal/recorder
 * @since 1.0.0
 *
 * 📝 BUILD[02.03]: Trace Recorder implementation
 * 📝 BUILD[02.04]: Prompt redaction support
 */

import type { InterceptorProvider, InterceptorRecorder } from "./interceptor";
import type {
  Checkpoint,
  CheckpointPayload,
  ExecutionTrace,
  RecorderOptions,
  TraceEvent,
  TraceEventPayload,
  TraceMetadata,
} from "./types";
import { TRACE_SCHEMA_VERSION } from "./types";
import { VectorClockManager } from "./vectorClock";

// ─────────────────────────────────────────────────────────────────────────────
// ID GENERATION
// ─────────────────────────────────────────────────────────────────────────────

let eventCounter = 0;
let checkpointCounter = 0;

function generateEventId(): string {
  return `evt_${Date.now().toString(36)}_${(++eventCounter).toString(36)}`;
}

function generateCheckpointId(): string {
  return `chk_${Date.now().toString(36)}_${(++checkpointCounter).toString(36)}`;
}

function generateTraceId(): string {
  return `trace_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 10)}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// HASH UTILITY
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Simple DJB2 hash for integrity verification.
 * Not cryptographically secure, but fast and deterministic.
 */
function djb2Hash(value: string): string {
  let hash = 5381;
  for (let i = 0; i < value.length; i++) {
    hash = (hash * 33) ^ value.charCodeAt(i);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/**
 * Compute hash of a trace event for integrity.
 */
function computeEventHash(event: Omit<TraceEvent, "hash">): string {
  const content = JSON.stringify({
    id: event.id,
    type: event.type,
    agentId: event.agentId,
    timestamp: event.timestamp,
    vectorClock: event.vectorClock,
    payload: event.payload,
  });
  return djb2Hash(content);
}

// ─────────────────────────────────────────────────────────────────────────────
// TRACE RECORDER
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Records execution traces with vector clocks, hashes, and metadata.
 *
 * @example
 * ```typescript
 * const recorder = new TraceRecorder({ includePrompts: false });
 *
 * // Record events
 * recorder.appendEvent({
 *   type: 'operator',
 *   agentId: 'agent-1',
 *   payload: { operator: 'map', durationMs: 10 }
 * });
 *
 * // Create checkpoint
 * recorder.createCheckpoint({ counter: 42 });
 *
 * // Finalize
 * const trace = recorder.finalize('final result');
 * ```
 */
export class TraceRecorder implements InterceptorRecorder {
  private readonly id: string;
  private readonly startTime: number;
  private readonly options: RecorderOptions;
  private readonly clockManager: VectorClockManager;
  private readonly events: TraceEvent[] = [];
  private readonly checkpoints: Checkpoint[] = [];
  private readonly interceptors: InterceptorProvider[] = [];
  private readonly redactPatterns: RegExp[];
  private agentId: string = "anonymous";
  private operatorChain: string[] = [];
  private finalized = false;

  constructor(options: RecorderOptions = {}) {
    this.id = generateTraceId();
    this.startTime = Date.now();
    this.options = options;
    this.clockManager = new VectorClockManager();
    this.redactPatterns = options.redactPatterns
      ? [...options.redactPatterns]
      : [];
  }

  /**
   * Set the current agent ID for events.
   */
  setAgentId(agentId: string): void {
    this.agentId = agentId;
  }

  /**
   * Get the current agent ID.
   */
  getAgentId(): string {
    return this.agentId;
  }

  /**
   * Set the operator chain from AgentUnit metadata.
   */
  setOperatorChain(chain: string[]): void {
    this.operatorChain = [...chain];
  }

  /**
   * Install an interceptor for recording.
   */
  installInterceptor(interceptor: InterceptorProvider): void {
    interceptor.install(this);
    this.interceptors.push(interceptor);
  }

  /**
   * Uninstall all interceptors.
   */
  uninstallInterceptors(): void {
    for (const interceptor of this.interceptors) {
      interceptor.uninstall();
    }
    this.interceptors.length = 0;
  }

  /**
   * Append an event to the trace.
   * Automatically adds id, timestamp, vectorClock, and hash.
   */
  appendEvent(
    event: Omit<TraceEvent, "id" | "timestamp" | "vectorClock" | "hash">,
  ): void {
    if (this.finalized) {
      throw new Error("Cannot append event to finalized trace");
    }

    // Tick the vector clock for this agent
    this.clockManager.tick(event.agentId);

    const partialEvent: Omit<TraceEvent, "hash"> = {
      id: generateEventId(),
      timestamp: Date.now(),
      vectorClock: this.clockManager.getClock(),
      type: event.type,
      agentId: event.agentId,
      payload: this.redactPayload(event.payload),
      durationMs: event.durationMs,
    };

    const fullEvent: TraceEvent = {
      ...partialEvent,
      hash: computeEventHash(partialEvent),
    };

    this.events.push(fullEvent);

    // Auto-checkpoint if configured
    const interval = this.options.checkpointInterval ?? 100;
    if (this.events.length % interval === 0) {
      // Note: Auto-checkpoints capture null state since we don't have context
      // Real checkpoints should be created explicitly with state
    }
  }

  /**
   * Create a checkpoint with the current state.
   * Used for efficient partial replay.
   *
   * @param state - The state to capture (must be JSON-serializable)
   * @returns The checkpoint ID
   */
  createCheckpoint<T>(state: T): string {
    if (this.finalized) {
      throw new Error("Cannot create checkpoint in finalized trace");
    }

    const id = generateCheckpointId();
    const serializedState = JSON.parse(JSON.stringify(state));
    const stateHash = djb2Hash(JSON.stringify(serializedState));

    const checkpoint: Checkpoint = {
      id,
      vectorClock: this.clockManager.getClock(),
      state: serializedState,
      timestamp: Date.now(),
      stateHash,
      eventIndex: this.events.length,
    };

    this.checkpoints.push(checkpoint);

    // Record checkpoint event
    const payload: CheckpointPayload = {
      checkpointId: id,
      stateHash,
      stateSizeBytes: JSON.stringify(serializedState).length,
    };

    this.appendEvent({
      type: "checkpoint",
      agentId: this.agentId,
      payload,
    });

    return id;
  }

  /**
   * Finalize the trace with the final output.
   *
   * @param finalOutput - The final computation result
   * @returns The complete execution trace
   */
  finalize<T>(finalOutput: T): ExecutionTrace<T> {
    if (this.finalized) {
      throw new Error("Trace already finalized");
    }

    this.finalized = true;
    this.uninstallInterceptors();

    const endTime = Date.now();

    // Compute metadata
    const agentIds = new Set(this.events.map((e) => e.agentId));

    const metadata: TraceMetadata = {
      composition: this.extractComposition(),
      agentCount: agentIds.size,
      eventCount: this.events.length,
      durationMs: endTime - this.startTime,
      schemaVersion: TRACE_SCHEMA_VERSION,
      operatorChain: this.operatorChain,
      includesPrompts: this.options.includePrompts ?? false,
      checkpointCount: this.checkpoints.length,
    };

    return {
      id: this.id,
      version: TRACE_SCHEMA_VERSION,
      startTime: this.startTime,
      endTime,
      events: Object.freeze([...this.events]),
      checkpoints: Object.freeze([...this.checkpoints]),
      metadata,
      finalOutput,
    };
  }

  /**
   * Get current event count.
   */
  getEventCount(): number {
    return this.events.length;
  }

  /**
   * Get current checkpoint count.
   */
  getCheckpointCount(): number {
    return this.checkpoints.length;
  }

  /**
   * Extract composition string from operator chain.
   */
  private extractComposition(): string {
    if (this.operatorChain.length === 0) {
      return "unknown";
    }
    return this.operatorChain.join(".");
  }

  /**
   * Redact sensitive data from payload.
   */
  private redactPayload(payload: TraceEventPayload): TraceEventPayload {
    if (this.redactPatterns.length === 0) {
      return payload;
    }

    // Deep clone and redact string fields
    const cloned = JSON.parse(JSON.stringify(payload));
    this.redactObject(cloned);
    return cloned;
  }

  /**
   * Recursively redact strings in an object.
   */
  private redactObject(obj: Record<string, unknown>): void {
    for (const key in obj) {
      const value = obj[key];
      if (typeof value === "string") {
        obj[key] = this.redactString(value);
      } else if (typeof value === "object" && value !== null) {
        this.redactObject(value as Record<string, unknown>);
      }
    }
  }

  /**
   * Redact patterns from a string.
   */
  private redactString(value: string): string {
    let result = value;
    for (const pattern of this.redactPatterns) {
      result = result.replace(pattern, "[REDACTED]");
    }
    return result;
  }
}
