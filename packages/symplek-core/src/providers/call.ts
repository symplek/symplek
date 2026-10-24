/**
 * @module providers/call
 * @description The two rules every model call follows, whichever entry point
 *   made it: which provider handles the call, and whether the provider
 *   answered. ai(), stream() and executeAgent() all go through here, so the
 *   same situation gives the same error on each path.
 *
 *   Server-side only: resolving a provider can load its adapter.
 *
 * @internal Not part of the public API surface.
 */

import { SymplekError } from "../errors";
import { detectProvider } from "./auto";
import { registerProviderFromEnv } from "./bootstrap";
import type { AIResponse, Provider } from "./interface";
import { providerRegistry } from "./registry";

/**
 * Find the provider for a call: the one asked for, or the detected one. A
 * provider whose key is in the environment is loaded on the way.
 *
 * @throws SymplekError(PROVIDER_ERROR) when the provider has no adapter.
 */
export async function resolveProvider(
  requestedId?: string,
): Promise<{ provider: Provider; providerId: string }> {
  const providerId = requestedId || detectProvider();
  await registerProviderFromEnv(providerId);
  const provider = providerRegistry.get(providerId);
  if (!provider) {
    throw new SymplekError({
      code: "PROVIDER_ERROR",
      message: `Provider "${providerId}" not found in registry.`,
      action:
        "Set a provider API key (e.g. OPENAI_API_KEY) or call Symplek.configure({ provider, apiKey }).",
      context: { providerId },
    });
  }
  return { provider, providerId };
}

/**
 * Throw when the provider did not answer. Two cases count:
 *   - the request was declined (`content_filter`), whatever was written;
 *   - the output limit was reached before any answer text was written.
 *
 * A reply cut off by the output limit after some text is returned as it is:
 * the caller has the partial text. A reply that finishes normally with no
 * text is also returned, as an empty string.
 *
 * @param hasText - For a stream, whether any text was yielded.
 * @throws SymplekError(PROVIDER_ERROR)
 */
export function checkProviderAnswer(
  finishReason: AIResponse["finishReason"] | undefined,
  hasText: boolean,
  providerId: string,
  model: string,
): void {
  if (finishReason === "content_filter") {
    throw new SymplekError({
      code: "PROVIDER_ERROR",
      message: `The ${providerId} provider declined to answer this request.`,
      action:
        "Rephrase the request, or handle this error where a refusal is an expected outcome.",
      context: { providerId, model, finishReason },
    });
  }
  if (finishReason === "length" && !hasText) {
    throw new SymplekError({
      code: "PROVIDER_ERROR",
      message: `The ${providerId} provider reached its output limit before writing any answer.`,
      action: "Raise maxTokens for this call.",
      context: { providerId, model, finishReason },
    });
  }
}
