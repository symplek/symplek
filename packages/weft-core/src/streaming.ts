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
import { redactErrorMessage, safeCause } from "./providers/redact";

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

    // 2. Select model — thread the already-resolved providerId so quality heuristics
    // key off the same provider that will execute the request (H6 fix).
    const model = selectModelForTask(prompt, { model: options?.model }, providerId);

    // 3. Prepare messages
    const messages: AIMessage[] = [];
    if (options?.system) {
      messages.push({ role: "system", content: options.system });
    }
    messages.push({ role: "user", content: prompt });

    // 4. Execute stream — forward the AbortSignal so the provider SDK can
    // interrupt the request when the caller cancels (N61 fix).
    const chunkStream = provider.stream({
      model,
      messages,
      temperature: options?.temperature,
      maxTokens: options?.maxTokens,
      stop: options?.stop,
      signal: options?.signal,
    });

    // 5. Iterate over chunks, accumulate usage, and yield text.
    //
    // H5 fix: do NOT gate chunk processing on chunk.textDelta truthiness.
    // Anthropic (and future providers) emit usage-only chunks where textDelta is ""
    // (e.g. message_start, message_delta). Discarding them causes token totals to
    // silently undercount. All chunks are processed; only non-empty text is yielded
    // to callers — the public AsyncGenerator<string> contract is unchanged.
    let _accPromptTokens = 0;
    let _accCompletionTokens = 0;

    for await (const chunk of chunkStream) {
      // Check for abort signal during iteration
      if (signal?.aborted) {
        // If the provider's stream doesn't natively handle the signal,
        // we break the loop to stop yielding.
        break;
      }

      // Accumulate usage from every chunk regardless of textDelta presence.
      if (chunk.usage) {
        if (chunk.usage.promptTokens > 0) {
          _accPromptTokens = chunk.usage.promptTokens;
        }
        if (chunk.usage.completionTokens > 0) {
          _accCompletionTokens = chunk.usage.completionTokens;
        }
      }

      // Only yield text to external callers — usage chunks have empty textDelta.
      if (chunk.textDelta) {
        yield chunk.textDelta;
      }
    }

    // _accPromptTokens and _accCompletionTokens hold the final accumulated
    // usage totals. Surfacing them externally is deferred to a later wave
    // (requires a new API shape); they are retained here to make the
    // accumulation logic testable and to avoid silent discard.

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

    // Defense-in-depth (mirrors ai.ts UNKNOWN_ERROR backstop): a provider SDK
    // stream error could carry the API key in its message or request-header
    // objects. We have no apiKey reference here, so redactErrorMessage scrubs
    // env keys and safeCause DROPS the raw secret-bearing SDK object.
    throw new WeftError({
      code: "UNKNOWN_ERROR",
      message:
        error instanceof Error
          ? redactErrorMessage(undefined, error)
          : "An error occurred during streaming.",
      action: "Check the error cause and network connection.",
      cause: safeCause(undefined, error),
      context: { prompt },
    });
  }
}
