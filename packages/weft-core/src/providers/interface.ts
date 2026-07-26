/**
 * @fileoverview Provider Interface for weft-core
 * @description Defines the unified interface and types for AI providers.
 * @rules .claude/rules/core/039-design-philosophy.md
 */

/**
 * Supported AI provider identifiers.
 */
export type ProviderId = "google" | "openai" | "anthropic" | string;

/**
 * Message roles for AI requests.
 */
export type MessageRole = "system" | "user" | "assistant" | "tool";

/**
 * A single message in a conversation.
 *
 * @remarks
 * For assistant turns that returned tool calls, populate `toolCalls` with the
 * provider's tool_call objects. Anthropic requires a `tool_use` content block
 * in the assistant message that precedes each `tool_result` block; the Anthropic
 * adapter reads `toolCalls` to emit that block. Without it, the adapter emits a
 * text-only assistant turn and Anthropic rejects the orphaned `tool_result`.
 */
export interface AIMessage {
  role: MessageRole;
  content: string;
  name?: string;
  toolCallId?: string;
  /**
   * Tool calls present in this assistant turn. Set by executeLoop() when the
   * provider returned tool calls alongside or instead of text.
   * Only populated for `role: "assistant"` messages.
   */
  toolCalls?: ToolCall[];
}

// ─── Structured Output ───────────────────────────────────────────────────────

/**
 * Response format for AI requests. Discriminated union that extends the legacy
 * { type: "text" | "json_object" } pair with json_schema for strict mode.
 *
 * Existing callers passing `{ type: "json_object" }` or `{ type: "text" }` are
 * valid members of this union — no changes required.
 *
 * For strict-mode callers: check ProviderCapabilities.strictStructuredOutput.
 * If false, the provider degrades to json_object + post-hoc validation.
 */
export type ResponseFormat =
  | { type: "text" }
  | { type: "json_object" }
  | {
      type: "json_schema";
      /** Name used in provider request schema field (Anthropic/OpenAI). */
      name: string;
      /** JSON Schema object. Must not use $ref for OpenAI strict mode. */
      schema: Record<string, unknown>;
      /** Enforce constrained decoding (only supported by select providers). */
      strict?: boolean;
      /**
       * Optional: the original Zod schema from which `schema` was derived.
       * When supplied, the Anthropic adapter uses Zod for post-hoc validation
       * instead of the partial JSON Schema walker. This enables complete
       * constraint enforcement (enum, min, max, pattern, anyOf, …). Without
       * this field, validation covers type, required, properties, and enum only.
       */
      zodSchema?: import("zod").ZodTypeAny;
    };

// ─── Typed Stream Parts ──────────────────────────────────────────────────────

/**
 * Discriminated union of all stream event types.
 * Existing stream() continues to return AsyncIterable<StreamChunk> unchanged.
 * The new optional streamParts() method returns AsyncIterable<StreamPart>.
 * Use textPartsOnly() from streaming-parts.ts to migrate text-only consumers.
 */
export type StreamPart =
  | TextDeltaPart
  | ToolCallPart
  | ToolResultPart
  | ReasoningPart
  | SourcePart
  | FinishPart;

/** Incremental text content. Anchored first in the union to aid migration. */
export interface TextDeltaPart {
  type: "text-delta";
  textDelta: string;
  usage?: AIUsage;
}

/** A complete tool call emitted by the model. Input is the full deserialized object. */
export interface ToolCallPart {
  type: "tool-call";
  toolCallId: string;
  toolName: string;
  input: unknown;
}

/** A tool result fed back into the conversation. */
export interface ToolResultPart {
  type: "tool-result";
  toolCallId: string;
  result: unknown;
  isError?: boolean;
}

/** Reasoning / chain-of-thought from extended thinking models. */
export interface ReasoningPart {
  type: "reasoning";
  reasoning: string;
}

/** A cited source from a retrieval-augmented response. */
export interface SourcePart {
  type: "source";
  sourceTitle?: string;
  sourceUrl: string;
}

/** Final part. Always the last item in a streamParts() iterable (unless aborted). */
export interface FinishPart {
  type: "finish";
  finishReason: AIResponse["finishReason"];
  usage: AIUsage;
}

/**
 * Request configuration for AI generation.
 */
export interface AIRequest {
  /** The model to use (e.g., 'gemini-2.0-flash', 'gpt-4o') */
  model: string;
  /** The conversation history */
  messages: AIMessage[];
  /** Sampling temperature (0-2) */
  temperature?: number;
  /** Maximum number of tokens to generate */
  maxTokens?: number;
  /** Stop sequences to terminate generation */
  stop?: string[];
  /** Top-p sampling (0-1) */
  topP?: number;
  /** Frequency penalty (-2 to 2) */
  frequencyPenalty?: number;
  /** Presence penalty (-2 to 2) */
  presencePenalty?: number;
  /** Seed for deterministic generation */
  seed?: number;
  /**
   * Response format. Use ResponseFormat for structured output guarantees.
   * json_schema + strict:true routes to constrained decoding when the provider
   * supports it (ProviderCapabilities.strictStructuredOutput); otherwise the
   * adapter degrades to json_object + post-hoc validation (see resolveResponseFormat).
   */
  responseFormat?: ResponseFormat;
  /**
   * Tool definitions available to the model. When present, the provider
   * may return tool_calls instead of text. Populated by executeLoop().
   */
  tools?: ToolDefinition[];
  /**
   * AbortSignal for cancelling in-flight requests.
   * N61 fix: wired through streaming.ts and into each provider's SDK call
   * so a stalled stream can be interrupted mid-stream, not just between chunks.
   */
  signal?: AbortSignal;
}

/**
 * Token usage information.
 */
export interface AIUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

/**
 * Response from an AI generation.
 */
export interface AIResponse {
  /** The generated text content */
  text: string;
  /** Token usage statistics */
  usage: AIUsage;
  /** Reason why the generation finished */
  finishReason: "stop" | "length" | "content_filter" | "tool_calls" | "other";
  /**
   * Tool calls requested by the model. Populated when finishReason === "tool_calls".
   * The caller should execute each tool and supply results as role:"tool" messages.
   */
  toolCalls?: ToolCall[];
  /** Raw provider response (optional) */
  raw?: any;
}

/**
 * A chunk of a streaming AI response.
 */
export interface StreamChunk {
  /** The incremental text delta */
  textDelta: string;
  /** Cumulative usage (if available from provider) */
  usage?: AIUsage;
  /** Finish reason (only present in the final chunk) */
  finishReason?: AIResponse["finishReason"];
}

// ─── Tool types ─────────────────────────────────────────────────────────────

/**
 * Tool definition sent to a provider. Describes a callable tool the LLM can invoke.
 * Construct from a Tool<P,R> using zodSchemaToJsonSchema() for the inputSchema.
 */
export interface ToolDefinition {
  name: string;
  description: string;
  /** JSON Schema object for the tool's input parameters. */
  inputSchema: Record<string, unknown>;
}

/**
 * A single tool call returned by the provider in a tool_calls response.
 */
export interface ToolCall {
  /** Provider-generated call identifier (used to correlate tool results). */
  id: string;
  /** Name of the tool to execute. */
  name: string;
  /** Deserialized input arguments for the tool. */
  input: unknown;
}

/**
 * Capabilities supported by a provider.
 */
export interface ProviderCapabilities {
  streaming: boolean;
  tools: boolean;
  vision: boolean;
  structuredOutput: boolean;
  /**
   * True when the provider enforces json_schema: either via constrained decoding
   * at generation time (OpenAI) or via post-hoc validation that throws on failure
   * (Anthropic). In both cases callers receive a conforming result or a clear
   * VALIDATION_ERROR — never silent garbage. False/absent = only json_object is
   * enforced; json_schema degrades to json_object mode with no validation.
   * Use resolveResponseFormat() before assuming strict mode succeeded.
   */
  strictStructuredOutput?: boolean;
  maxContextTokens: number;
}

/**
 * Unified interface for AI providers.
 */
export interface Provider {
  /** Unique provider identifier */
  readonly id: ProviderId;

  /** Human-readable provider name */
  readonly name: string;

  /** Provider capabilities */
  readonly capabilities: ProviderCapabilities;

  /**
   * Generate a complete response.
   *
   * @param request - The generation request
   * @returns A promise resolving to the AI response
   */
  generate(request: AIRequest): Promise<AIResponse>;

  /**
   * Stream a response.
   *
   * @param request - The generation request
   * @returns An async iterable of stream chunks
   */
  stream(request: AIRequest): AsyncIterable<StreamChunk>;

  /**
   * Stream typed parts. Optional — providers that implement this emit richer
   * events (tool-call, reasoning, source) in addition to text-delta and finish.
   * Providers that don't implement it fall back to the stream()→TextDeltaPart
   * adapter in streaming-parts.ts via streamPartsFromChunks().
   *
   * Abort: if request.signal aborts mid-stream, the iterable closes without
   * emitting a FinishPart.
   */
  streamParts?(request: AIRequest): AsyncIterable<StreamPart>;

  /**
   * Identify the provider and its current configuration.
   */
  identify(): { id: ProviderId; name: string; version?: string };
}
