/**
 * @fileoverview Interceptor interfaces and LLM interceptor implementation
 * @description Pluggable interception for recording/replaying non-deterministic calls
 * @module weft-core/rehearsal/interceptor
 * @since 1.0.0
 *
 * 📝 BUILD[02.01]: Interceptor Provider Interface
 * 📝 BUILD[02.02]: LLM Interceptor Implementation
 */

import type { LLMCallPayload, LLMResponsePayload, TraceEvent } from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// INTERCEPTOR PROVIDER INTERFACE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Interface for pluggable interceptors.
 *
 * Interceptors hook into non-deterministic operations (LLM calls, database queries)
 * to enable recording and deterministic replay.
 *
 * @example
 * ```typescript
 * class CustomInterceptor implements InterceptorProvider {
 *   name = 'custom';
 *
 *   install(recorder: TraceRecorder): void {
 *     // Hook into the operation
 *   }
 *
 *   uninstall(): void {
 *     // Remove hooks
 *   }
 *
 *   intercept(request: unknown): Promise<unknown> | undefined {
 *     // Return cached response or undefined to proceed
 *   }
 * }
 * ```
 */
export interface InterceptorProvider {
  /** Unique name for this interceptor */
  readonly name: string;

  /**
   * Install the interceptor with a recorder.
   * Called when recording starts.
   *
   * @param recorder - The trace recorder to send events to
   */
  install(recorder: InterceptorRecorder): void;

  /**
   * Uninstall the interceptor.
   * Called when recording ends (even on error).
   */
  uninstall(): void;

  /**
   * Intercept a request during replay.
   *
   * @param request - The request being made
   * @returns Cached response if available, undefined to proceed with real call
   */
  intercept(request: unknown): Promise<unknown> | undefined;
}

/**
 * Minimal interface for recorders that interceptors need.
 * Allows interceptors to append events without full TraceRecorder dependency.
 */
export interface InterceptorRecorder {
  /**
   * Append an event to the trace.
   *
   * @param event - Partial event (id, timestamp, vectorClock, hash added automatically)
   */
  appendEvent(
    event: Omit<TraceEvent, "id" | "timestamp" | "vectorClock" | "hash">,
  ): void;

  /**
   * Get the current agent ID.
   */
  getAgentId(): string;
}

// ─────────────────────────────────────────────────────────────────────────────
// LLM CALL TYPES
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Configuration for an LLM call.
 */
export interface LLMCallConfig {
  model: string;
  prompt: string;
  systemPrompt?: string;
  temperature?: number;
  maxTokens?: number;
}

/**
 * Response from an LLM call.
 */
export interface LLMCallResponse {
  response: string;
  tokensUsed?: number;
  finishReason?: string;
  latencyMs: number;
}

/**
 * Recorded LLM interaction for replay.
 */
export interface RecordedLLMCall {
  config: LLMCallConfig;
  configHash: string;
  response: LLMCallResponse;
  responseHash: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// LLM INTERCEPTOR (RECORDING MODE)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Interceptor for recording LLM calls during execution.
 *
 * @example
 * ```typescript
 * const interceptor = new RecordingLLMInterceptor({ includePrompts: false });
 *
 * // Intercept a call
 * const result = await interceptor.recordCall(
 *   { model: 'gpt-4', prompt: 'Hello' },
 *   async (config) => {
 *     // Actual LLM call
 *     return { response: 'Hi!', latencyMs: 100 };
 *   }
 * );
 * ```
 */
export class RecordingLLMInterceptor implements InterceptorProvider {
  readonly name = "llm";

  private recorder: InterceptorRecorder | null = null;
  private readonly includePrompts: boolean;
  private readonly redactPatterns: RegExp[];
  private calls: RecordedLLMCall[] = [];

  constructor(options?: {
    includePrompts?: boolean;
    redactPatterns?: RegExp[];
  }) {
    this.includePrompts = options?.includePrompts ?? false;
    this.redactPatterns = options?.redactPatterns ?? [];
  }

  install(recorder: InterceptorRecorder): void {
    this.recorder = recorder;
    this.calls = [];
  }

  uninstall(): void {
    this.recorder = null;
  }

  intercept(_request: unknown): Promise<unknown> | undefined {
    // Recording mode doesn't intercept - let calls proceed
    return undefined;
  }

  /**
   * Record an LLM call and its response.
   *
   * @param config - The call configuration
   * @param execute - Function that executes the actual LLM call
   * @returns The LLM response
   */
  async recordCall<T extends LLMCallResponse>(
    config: LLMCallConfig,
    execute: (config: LLMCallConfig) => Promise<T>,
  ): Promise<T> {
    const startTime = Date.now();

    // Record the call event
    if (this.recorder) {
      const callPayload: LLMCallPayload = {
        model: config.model,
        prompt: this.includePrompts ? this.redact(config.prompt) : undefined,
        promptHash: this.hash(config.prompt),
        temperature: config.temperature,
        maxTokens: config.maxTokens,
        systemPrompt: this.includePrompts
          ? this.redact(config.systemPrompt)
          : undefined,
      };

      this.recorder.appendEvent({
        type: "llm_call",
        agentId: this.recorder.getAgentId(),
        payload: callPayload,
      });
    }

    // Execute the actual call
    const response = await execute(config);
    const latencyMs = Date.now() - startTime;

    // Record the response event.
    // The response text is ALWAYS stored (after redaction) so that the replay
    // interceptor can return the real response rather than falling back to "".
    // `includePrompts` only gates the PROMPT text (privacy concern); the
    // response must be present for deterministic replay.
    if (this.recorder) {
      const responsePayload: LLMResponsePayload = {
        model: config.model,
        response: this.redact(response.response),
        responseHash: this.hash(response.response),
        tokensUsed: response.tokensUsed,
        finishReason: response.finishReason,
        latencyMs,
      };

      this.recorder.appendEvent({
        type: "llm_response",
        agentId: this.recorder.getAgentId(),
        payload: responsePayload,
        durationMs: latencyMs,
      });
    }

    // Store for potential serialization
    const recorded: RecordedLLMCall = {
      config,
      configHash: this.hash(JSON.stringify(config)),
      response: { ...response, latencyMs },
      responseHash: this.hash(response.response),
    };
    this.calls.push(recorded);

    return response;
  }

  /**
   * Get all recorded calls.
   */
  getCalls(): RecordedLLMCall[] {
    return [...this.calls];
  }

  /**
   * Redact sensitive content from a string.
   */
  private redact(value: string | undefined): string | undefined {
    if (!value) return value;
    let result = value;
    for (const pattern of this.redactPatterns) {
      result = result.replace(pattern, "[REDACTED]");
    }
    return result;
  }

  /**
   * Simple hash function for content comparison (DJB2).
   */
  private hash(value: string): string {
    let hash = 5381;
    for (let i = 0; i < value.length; i++) {
      hash = (hash * 33) ^ value.charCodeAt(i);
    }
    return (hash >>> 0).toString(16).padStart(8, "0");
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// LLM INTERCEPTOR (REPLAY MODE)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Interceptor for replaying recorded LLM calls.
 *
 * Instead of making actual API calls, returns cached responses
 * from the recorded trace.
 *
 * @example
 * ```typescript
 * const interceptor = new ReplayLLMInterceptor(recordedCalls);
 *
 * // Returns cached response without API call
 * const result = await interceptor.replayCall({ model: 'gpt-4', prompt: 'Hello' });
 * ```
 */
export class ReplayLLMInterceptor implements InterceptorProvider {
  readonly name = "llm";

  private readonly calls: RecordedLLMCall[];
  private callIndex = 0;
  // Recorder ref is part of the InterceptorProvider contract — install/uninstall
  // must accept and clear it. ReplayLLMInterceptor never reads this field
  // (replay is sourced from `calls`, not the live recorder), but the assignments
  // are still required so the lifecycle works. The `void` reads below keep
  // biome's noUnusedPrivateClassMembers honest without weakening the type.
  private recorder: InterceptorRecorder | null = null;

  constructor(calls: RecordedLLMCall[]) {
    this.calls = calls;
  }

  install(recorder: InterceptorRecorder): void {
    this.recorder = recorder;
    void this.recorder;
    this.callIndex = 0;
  }

  uninstall(): void {
    this.recorder = null;
    void this.recorder;
  }

  intercept(request: unknown): Promise<unknown> | undefined {
    // Check if this looks like an LLM call config
    if (this.isLLMCallConfig(request)) {
      return this.replayCall(request);
    }
    return undefined;
  }

  /**
   * Replay a recorded LLM call.
   *
   * @param config - The call configuration
   * @returns The cached response
   * @throws Error if no matching recorded call
   */
  async replayCall(config: LLMCallConfig): Promise<LLMCallResponse> {
    if (this.callIndex >= this.calls.length) {
      throw new Error(
        `Replay exhausted - no more recorded LLM calls (expected call #${this.callIndex + 1})`,
      );
    }

    const recorded = this.calls[this.callIndex++];

    // Verify config hash matches (optional strict mode)
    const configHash = this.hash(JSON.stringify(config));
    if (configHash !== recorded.configHash) {
      // Log warning but continue (prompt may have minor differences)
      console.warn(
        `LLM call config mismatch at index ${this.callIndex - 1}: ` +
          `expected hash ${recorded.configHash}, got ${configHash}`,
      );
    }

    return recorded.response;
  }

  /**
   * Get remaining call count.
   */
  getRemainingCalls(): number {
    return this.calls.length - this.callIndex;
  }

  /**
   * Reset replay index.
   */
  reset(): void {
    this.callIndex = 0;
  }

  /**
   * Check if value is an LLM call config.
   */
  private isLLMCallConfig(value: unknown): value is LLMCallConfig {
    return (
      typeof value === "object" &&
      value !== null &&
      "model" in value &&
      "prompt" in value
    );
  }

  /**
   * Simple hash function (DJB2).
   */
  private hash(value: string): string {
    let hash = 5381;
    for (let i = 0; i < value.length; i++) {
      hash = (hash * 33) ^ value.charCodeAt(i);
    }
    return (hash >>> 0).toString(16).padStart(8, "0");
  }
}
