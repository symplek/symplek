/**
 * @fileoverview Provider Interface for @weft/core
 * @description Defines the unified interface and types for AI providers.
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
 */
export interface AIMessage {
  role: MessageRole;
  content: string;
  name?: string;
  toolCallId?: string;
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
  /** Response format (e.g., { type: 'json_object' }) */
  responseFormat?: { type: "text" | "json_object" };
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

/**
 * Capabilities supported by a provider.
 */
export interface ProviderCapabilities {
  streaming: boolean;
  tools: boolean;
  vision: boolean;
  structuredOutput: boolean;
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
   * Identify the provider and its current configuration.
   */
  identify(): { id: ProviderId; name: string; version?: string };
}
