/**
 * @module providers/known
 * @description Which providers exist and which environment variable holds
 *   each one's key. Deliberately free of any adapter import: provider
 *   detection (auto.ts) is reachable from the browser-safe root entry, and
 *   must not drag the SDK loaders in with it. Loading adapters is
 *   providers/bootstrap.ts, which is server-side only.
 *
 * @internal Not part of the public API surface.
 */

/** Providers with a built-in adapter, in detection-priority order. */
export const KNOWN_PROVIDERS = [
  { id: "openai", name: "OpenAI", envKey: "OPENAI_API_KEY" },
  { id: "anthropic", name: "Anthropic", envKey: "ANTHROPIC_API_KEY" },
  { id: "google", name: "Google", envKey: "GOOGLE_GENERATIVE_AI_API_KEY" },
] as const;

export type KnownProviderId = (typeof KNOWN_PROVIDERS)[number]["id"];

/** The API key for a provider from its conventional environment variable. */
export function getEnvKeyForProvider(providerId: string): string | undefined {
  const envKey = KNOWN_PROVIDERS.find((p) => p.id === providerId)?.envKey;
  return envKey ? process.env[envKey] || undefined : undefined;
}
