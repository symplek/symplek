/**
 * @module providers/bootstrap
 * @description The one place that knows how to load a provider's adapter.
 *   `Weft.configure()` (facade.ts) and the execution paths (ai.ts,
 *   streaming.ts, agent/executor.ts) all load through here. Which providers
 *   exist, and their environment variables, is providers/known.ts.
 *
 * @internal Not part of the public API surface.
 */

import { WeftError } from "../errors";
import type { Provider } from "./interface";
import {
  getEnvKeyForProvider,
  KNOWN_PROVIDERS,
  type KnownProviderId,
} from "./known";
import { providerRegistry } from "./registry";

/**
 * Load a provider's adapter and build it with the given key. The provider SDK
 * is imported here, on first use, never at module load.
 *
 * @throws WeftError(PROVIDER_ERROR) for a provider id with no adapter.
 */
export async function createProviderAdapter(
  providerId: string,
  apiKey: string,
): Promise<Provider> {
  switch (providerId as KnownProviderId) {
    case "openai": {
      const { createOpenAIProvider } = await import("./openai");
      return createOpenAIProvider(apiKey);
    }
    case "anthropic": {
      const { createAnthropicProvider } = await import("./anthropic");
      return createAnthropicProvider(apiKey);
    }
    case "google": {
      const { createGoogleProvider } = await import("./google");
      return createGoogleProvider(apiKey);
    }
    default:
      throw new WeftError({
        code: "PROVIDER_ERROR",
        why: `Unknown provider "${String(providerId)}". Supported providers: ${KNOWN_PROVIDERS.map((p) => p.id).join(", ")}.`,
        fix: {
          description: "Use one of the supported provider identifiers.",
          docsUrl: "https://github.com/wefthq/weft#install",
        },
        example: `Weft.configure({ provider: "openai", apiKey: process.env.OPENAI_API_KEY })`,
      });
  }
}

/**
 * Make a provider key in the environment sufficient on its own. When
 * `providerId` has no registered adapter but its environment variable is set,
 * load the adapter and register it. Returns true when it registered one.
 *
 * A provider loaded this way is reachable by id and is never made the
 * default. With no configured default, each call that names no provider is
 * routed by the key order in KNOWN_PROVIDERS, so the provider that happened to
 * be reached for first does not capture every later call.
 */
export async function registerProviderFromEnv(
  providerId: string,
): Promise<boolean> {
  if (providerRegistry.get(providerId)) return false;
  const apiKey = getEnvKeyForProvider(providerId);
  if (!apiKey) return false;

  const provider = await createProviderAdapter(providerId, apiKey);
  // Another first call, or a configure(), may have registered this provider
  // while the adapter was loading. The earlier registration stands.
  if (!providerRegistry.get(providerId)) {
    providerRegistry.makeAvailable(provider);
  }
  return true;
}
