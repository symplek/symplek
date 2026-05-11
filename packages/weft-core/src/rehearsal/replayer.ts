/**
 * @fileoverview Trace Replayer for deterministic playback
 * @description Replays execution traces with divergence detection
 * @module @weft/core/rehearsal/replayer
 * @since 1.0.0
 *
 * 📝 BUILD[03.03]: Version Checker
 * 📝 BUILD[03.05]: Trace Replayer implementation
 * 📝 BUILD[03.06]: Partial Replay support
 */

import { CheckpointManager } from "./checkpoint";
import { type RecordedLLMCall, ReplayLLMInterceptor } from "./interceptor";
import { DependencyScheduler } from "./scheduler";
import type {
  Divergence,
  ExecutionTrace,
  ReplayerOptions,
  ReplayResult,
  TraceEvent,
} from "./types";
import {
  ReplayDivergenceError,
  TRACE_SCHEMA_VERSION,
  TraceVersionError,
} from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// VERSION CHECKER
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Check if a trace version is compatible with the current schema.
 *
 * @param traceVersion - Version from trace
 * @returns true if compatible
 */
export function isVersionCompatible(traceVersion: string): boolean {
  // For now, only exact match is compatible
  // Future: implement semantic versioning compatibility
  return traceVersion === TRACE_SCHEMA_VERSION;
}

/**
 * Validate trace version and throw if incompatible.
 *
 * @param trace - The trace to validate
 * @throws TraceVersionError if incompatible
 */
export function validateTraceVersion(trace: ExecutionTrace): void {
  if (!isVersionCompatible(trace.version)) {
    throw new TraceVersionError(trace.version, TRACE_SCHEMA_VERSION);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// TRACE REPLAYER
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Replays execution traces deterministically with divergence detection.
 *
 * @example
 * ```typescript
 * const replayer = new TraceReplayer(trace);
 *
 * // Replay all events
 * const result = await replayer.replay(async (event) => {
 *   // Process event
 *   return someValue;
 * });
 *
 * console.log(result.matched); // true if no divergences
 * console.log(result.divergences); // any detected issues
 * ```
 */
export class TraceReplayer<T = unknown> {
  private readonly trace: ExecutionTrace<T>;
  private readonly scheduler: DependencyScheduler;
  private readonly checkpointManager: CheckpointManager;
  private readonly options: ReplayerOptions;
  private readonly divergences: Divergence[] = [];
  private readonly llmInterceptor: ReplayLLMInterceptor | null;

  constructor(trace: ExecutionTrace<T>, options: ReplayerOptions = {}) {
    // Validate version
    validateTraceVersion(trace);

    this.trace = trace;
    this.options = options;
    this.scheduler = new DependencyScheduler(trace.events);
    this.checkpointManager = new CheckpointManager(trace);

    // Set up LLM interceptor from recorded calls
    const llmCalls = this.extractLLMCalls(trace);
    this.llmInterceptor =
      llmCalls.length > 0 ? new ReplayLLMInterceptor(llmCalls) : null;

    // Apply checkpoint if specified
    if (options.fromCheckpoint) {
      this.skipToCheckpoint(options.fromCheckpoint);
    }
  }

  /**
   * Replay the trace, calling handler for each event.
   *
   * @param handler - Function to handle each event
   * @returns Replay result with value and divergences
   */
  async replay(
    handler?: (event: TraceEvent) => Promise<unknown> | unknown,
  ): Promise<ReplayResult<T>> {
    const maxEvents = this.options.stopAfterEvents ?? Infinity;
    let eventsReplayed = 0;

    while (this.scheduler.hasNext() && eventsReplayed < maxEvents) {
      const event = this.scheduler.next();
      eventsReplayed++;

      try {
        if (handler) {
          const result = await handler(event);

          // Check for divergence if handler returns a hash-able result
          if (result !== undefined) {
            this.checkDivergence(event, result);
          }
        }
      } catch (error) {
        // Record error as divergence
        this.recordDivergence(event, "expected success", error, "critical");

        // Re-throw if critical
        if (error instanceof ReplayDivergenceError) {
          throw error;
        }
      }
    }

    // Check if we processed all events
    const totalEvents = this.scheduler.getTotalEvents();
    const allProcessed = eventsReplayed === totalEvents;

    // Determine match status
    const criticalDivergences = this.divergences.filter(
      (d) => d.severity === "critical",
    );
    const matched = criticalDivergences.length === 0 && allProcessed;

    return {
      value: this.trace.finalOutput,
      divergences: [...this.divergences],
      matched,
      eventsReplayed,
      totalEvents,
    };
  }

  /**
   * Get the LLM interceptor for replay.
   * Used by agent compositions to get cached responses.
   */
  getLLMInterceptor(): ReplayLLMInterceptor | null {
    return this.llmInterceptor;
  }

  /**
   * Get recorded divergences.
   */
  getDivergences(): readonly Divergence[] {
    return this.divergences;
  }

  /**
   * Get checkpoint manager.
   */
  getCheckpointManager(): CheckpointManager {
    return this.checkpointManager;
  }

  /**
   * Skip to a specific checkpoint.
   *
   * @param checkpointId - ID of checkpoint to skip to
   * @throws Error if checkpoint not found
   */
  skipToCheckpoint(checkpointId: string): void {
    const checkpoint = this.checkpointManager.getCheckpointById(checkpointId);
    if (!checkpoint) {
      throw new Error(`Checkpoint not found: ${checkpointId}`);
    }

    // Verify checkpoint integrity
    if (!this.checkpointManager.verifyCheckpoint(checkpoint)) {
      this.recordDivergence(
        null,
        checkpoint.stateHash,
        "hash_mismatch",
        "warning",
      );
    }

    // Skip scheduler to checkpoint's event index
    this.scheduler.skipTo(checkpoint.eventIndex);
  }

  /**
   * Restore state from the nearest checkpoint before an event.
   *
   * @param eventIndex - Target event index
   * @returns Restored state, or undefined if no checkpoint
   */
  restoreNearestCheckpoint<S>(eventIndex: number): S | undefined {
    const checkpoint =
      this.checkpointManager.getNearestCheckpointBefore(eventIndex);
    if (!checkpoint) {
      return undefined;
    }

    this.scheduler.skipTo(checkpoint.eventIndex);
    return this.checkpointManager.restoreState(checkpoint);
  }

  /**
   * Check for divergence in a result.
   */
  private checkDivergence(event: TraceEvent, actual: unknown): void {
    // Compare hashes if available
    const payload = event.payload as unknown as Record<string, unknown>;
    const expectedHash = payload.responseHash ?? payload.outputHash;

    if (expectedHash && typeof actual === "string") {
      const actualHash = this.computeHash(actual);
      if (actualHash !== expectedHash) {
        this.recordDivergence(event, expectedHash, actualHash, "warning");
        this.options.onDivergence?.({
          eventId: event.id,
          expected: expectedHash,
          actual: actualHash,
          severity: "warning",
          description: `Hash mismatch at event ${event.id}`,
        });
      }
    }
  }

  /**
   * Record a divergence.
   */
  private recordDivergence(
    event: TraceEvent | null,
    expected: unknown,
    actual: unknown,
    severity: "critical" | "warning" | "info",
  ): void {
    const divergence: Divergence = {
      eventId: event?.id ?? "unknown",
      expected,
      actual,
      severity,
      description: `Divergence at ${event?.type ?? "unknown"}: expected ${String(expected)}, got ${String(actual)}`,
    };

    this.divergences.push(divergence);
    try {
      this.options.onDivergence?.(divergence);
    } catch (error) {
      console.error(`Error in onDivergence callback: ${error}`);
    }
  }

  /**
   * Extract LLM calls from trace for replay.
   */
  private extractLLMCalls(trace: ExecutionTrace): RecordedLLMCall[] {
    const calls: RecordedLLMCall[] = [];
    let pendingCall: Partial<RecordedLLMCall> | null = null;

    for (const event of trace.events) {
      if (event.type === "llm_call") {
        const payload = event.payload as unknown as Record<string, unknown>;
        pendingCall = {
          config: {
            model: payload.model as string,
            prompt: (payload.prompt as string) ?? "",
            systemPrompt: payload.systemPrompt as string | undefined,
            temperature: payload.temperature as number | undefined,
            maxTokens: payload.maxTokens as number | undefined,
          },
          configHash: payload.promptHash as string,
        };
      } else if (event.type === "llm_response" && pendingCall) {
        const payload = event.payload as unknown as Record<string, unknown>;
        pendingCall.response = {
          response: (payload.response as string) ?? "",
          tokensUsed: payload.tokensUsed as number | undefined,
          finishReason: payload.finishReason as string | undefined,
          latencyMs: payload.latencyMs as number,
        };
        pendingCall.responseHash = payload.responseHash as string;

        if (
          pendingCall.config &&
          pendingCall.response &&
          pendingCall.configHash &&
          pendingCall.responseHash
        ) {
          calls.push(pendingCall as RecordedLLMCall);
        }
        pendingCall = null;
      }
    }

    return calls;
  }

  /**
   * Compute DJB2 hash.
   */
  private computeHash(value: string): string {
    let hash = 5381;
    for (let i = 0; i < value.length; i++) {
      hash = (hash * 33) ^ value.charCodeAt(i);
    }
    return (hash >>> 0).toString(16).padStart(8, "0");
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// UTILITY FUNCTIONS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create a replayer for a trace.
 *
 * @param trace - The trace to replay
 * @param options - Replay options
 */
export function createReplayer<T>(
  trace: ExecutionTrace<T>,
  options?: ReplayerOptions,
): TraceReplayer<T> {
  return new TraceReplayer(trace, options);
}

/**
 * Quick replay a trace and return result.
 *
 * @param trace - The trace to replay
 * @param handler - Optional event handler
 */
export async function replayTrace<T>(
  trace: ExecutionTrace<T>,
  handler?: (event: TraceEvent) => Promise<unknown> | unknown,
): Promise<ReplayResult<T>> {
  const replayer = createReplayer(trace);
  return replayer.replay(handler);
}
