/**
 * @fileoverview Streaming utilities for weft-core
 * @description Provides a unified interface for real-time AI response streaming.
 */

import { WeftError } from "./errors";
import { clearInitPromise, getInitPromise } from "./globalConfig";
import {
  type AIMessage,
  detectProvider,
  providerRegistry,
  selectModelForTask,
} from "./providers";

/**
 * Options for streaming AI responses.
 */
export interface StreamOptions {
  /** Explicit model name to use */
  model?: string;
  /** Optional provider identifier */
  provider?: string;
  /** AbortSignal to cancel the stream */
  signal?: AbortSignal;
  /** System prompt to prepend */
  system?: string;
  /** Sampling temperature (0-2) */
  temperature?: number;
  /** Maximum number of tokens to generate */
  maxTokens?: number;
  /** Stop sequences to terminate generation */
  stop?: string[];
}

/**
 * Implementation of ai.stream() for real-time streaming of AI responses.
 *
 * @param prompt - The user prompt
 * @param options - Streaming configuration
 * @returns An AsyncGenerator yielding text chunks
 */
export async function* stream(
  prompt: string,
  options?: StreamOptions,
): AsyncGenerator<string> {
  // Drain the deferred provider bootstrap enqueued by Weft.configure().
  // Mirrors the same drain in ai.ts (aiImplementation). Without this, a caller
  // who does `Weft.configure({ provider, apiKey }); Weft.stream(...)` will
  // call detectProvider() before the configured adapter is registered and fail
  // with "provider not found".
  const initP = getInitPromise();
  if (initP) {
    await initP;
    clearInitPromise();
  }

  const signal = options?.signal;

  // Check if already aborted
  if (signal?.aborted) {
    throw new WeftError({
      code: "UNKNOWN_ERROR",
      message: "Stream aborted before starting.",
      action: "Check the AbortSignal status.",
      context: { prompt },
    });
  }

  try {
    // 1. Detect provider
    const providerId = options?.provider || detectProvider();
    const provider = providerRegistry.get(providerId);

    if (!provider) {
      throw new WeftError({
        code: "PROVIDER_ERROR",
        message: `Provider "${providerId}" not found in registry.`,
        action: "Ensure the provider is registered and the API key is set.",
        context: { providerId },
      });
    }

    // 2. Select model
    const model = selectModelForTask(prompt, { model: options?.model });

    // 3. Prepare messages
    const messages: AIMessage[] = [];
    if (options?.system) {
      messages.push({ role: "system", content: options.system });
    }
    messages.push({ role: "user", content: prompt });

    // 4. Execute stream
    const chunkStream = provider.stream({
      model,
      messages,
      temperature: options?.temperature,
      maxTokens: options?.maxTokens,
      stop: options?.stop,
    });

    // 5. Iterate over chunks and yield text
    for await (const chunk of chunkStream) {
      // Check for abort signal during iteration
      if (signal?.aborted) {
        // If the provider's stream doesn't natively handle the signal,
        // we break the loop to stop yielding.
        break;
      }

      if (chunk.textDelta) {
        yield chunk.textDelta;
      }
    }

    if (signal?.aborted) {
      throw new WeftError({
        code: "UNKNOWN_ERROR",
        message: "Stream aborted.",
        action: "Check the AbortSignal status.",
        context: { prompt },
      });
    }
  } catch (error) {
    if (error instanceof WeftError) throw error;

    // Handle provider-specific or network errors
    throw new WeftError({
      code: "UNKNOWN_ERROR",
      message:
        error instanceof Error
          ? error.message
          : "An error occurred during streaming.",
      action: "Check the error cause and network connection.",
      cause: error,
      context: { prompt },
    });
  }
}
