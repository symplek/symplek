/**
 * @module providers/bootstrap - Shared lazy-bootstrap for provider adapters
 * @description Provides `bootstrapProviderByIdAndKey` for use by both
 *   `facade.ts` (configure-path) and `ai.ts`/`streaming.ts`/`executor.ts`
 *   (lazy env-key path). Keeping the logic here prevents duplication and ensures
 *   every execution path registers through the same registry singleton.
 *
 * @internal — not part of the public API surface.
 */

import { SymplekError } from "../errors";
import { providerRegistry } from "./registry";

/**
 * Conventional environment variable names per provider ID.
 * Used to look up an API key when `configure()` was not called.
 */
export const PROVIDER_ENV_KEYS: Record<string, string> = {
  openai: "OPENAI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  google: "GOOGLE_GENERATIVE_AI_API_KEY",
};

/**
 * Return the environment-variable API key for a known provider, or undefined
 * if the env var is not set.
 */
export function getEnvKeyForProvider(providerId: string): string | undefined {
  const envVar = PROVIDER_ENV_KEYS[providerId];
  return envVar ? (process.env[envVar] ?? undefined) : undefined;
}

/**
 * Dynamically import and register a provider adapter by ID and API key.
 * Safe to call when the provider may already be registered — the registry
 * `register(p, true)` call sets it as the default, which is consistent with
 * the behaviour of `configure()`.
 *
 * @throws SymplekError(PROVIDER_ERROR) for unknown provider IDs.
 */
export async function bootstrapProviderByIdAndKey(
  providerId: string,
  apiKey: string,
): Promise<void> {
  switch (providerId) {
    case "openai": {
      const { createOpenAIProvider } = await import("./openai");
      providerRegistry.register(await createOpenAIProvider(apiKey), true);
      break;
    }
    case "anthropic": {
      const { createAnthropicProvider } = await import("./anthropic");
      providerRegistry.register(await createAnthropicProvider(apiKey), true);
      break;
    }
    case "google": {
      const { createGoogleProvider } = await import("./google");
      providerRegistry.register(await createGoogleProvider(apiKey), true);
      break;
    }
    default: {
      throw new SymplekError({
        code: "PROVIDER_ERROR",
        why: `Unknown provider "${providerId}". Supported providers: openai, anthropic, google.`,
        fix: {
          description: `Use one of the supported provider identifiers.`,
          docsUrl: "https://github.com/symplek/symplek#provider-setup",
        },
        example: `Symplek.configure({ provider: "openai", apiKey: process.env.OPENAI_API_KEY })`,
      });
    }
  }
}

/**
 * If `providerId` is not yet in the registry, try to bootstrap it from the
 * matching environment variable. Does nothing if the provider is already
 * registered or if no env key is available. Returns true when a new
 * bootstrap was performed, false otherwise.
 *
 * Call this immediately after `providerRegistry.get(providerId)` returns
 * undefined to implement the "env key is sufficient without configure()"
 * promise from the documentation.
 */
export async function lazyBootstrapFromEnv(
  providerId: string,
): Promise<boolean> {
  // Do not re-bootstrap an already-registered provider.
  if (providerRegistry.get(providerId)) return false;

  const envKey = getEnvKeyForProvider(providerId);
  if (!envKey) return false;

  await bootstrapProviderByIdAndKey(providerId, envKey);
  return true;
}
