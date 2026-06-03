/**
 * @fileoverview Auto-detection and model selection for weft-core
 * @description Implements automatic provider detection from environment variables and intelligent model selection.
 */

import { WeftError } from "../errors";
import { getGlobalConfig } from "../globalConfig";
import type { ProviderId } from "./interface";
import { providerRegistry } from "./registry";

/**
 * Provider-specific default models for each quality tier.
 *
 * These are the canonical model IDs for each provider at each quality level.
 * Kept in one place so that heuristic logic in selectModelForTask reads from
 * this table rather than hardcoding strings inline.
 *
 * Rules:
 * - "high" → best available model for the provider (reasoning/flagship)
 * - "fast" → smallest/fastest model for the provider (mini/flash/haiku)
 * - "default" → safe fallback when no quality tier is specified
 *
 * Update this table when providers release new model families.
 */
const PROVIDER_MODEL_DEFAULTS: Record<
  string,
  { high: string; fast: string; default: string }
> = {
  openai: {
    high: "gpt-4o",
    fast: "gpt-4o-mini",
    default: "gpt-4o-mini",
  },
  anthropic: {
    high: "claude-opus-4-5",
    fast: "claude-haiku-3-5",
    default: "claude-sonnet-4-5",
  },
  google: {
    high: "gemini-1.5-pro",
    fast: "gemini-2.0-flash",
    default: "gemini-2.0-flash",
  },
};

/**
 * Options for AI generation that influence model selection.
 */
export interface AIOptions {
  /** Explicit model name to use */
  model?: string;
  /** Desired quality level */
  quality?: "high" | "fast";
  /** Additional custom options */
  [key: string]: any;
}

/**
 * Detects the best available provider based on registry first, then environment variables.
 *
 * Priority ordering:
 * 1. Registry default provider (for tests and manual registration)
 * 2. Environment variables: OPENAI → ANTHROPIC → GOOGLE
 *
 * PREVENTION: Check registry first for test mocks and manual registration
 * Fixed: 2026-01-27 - Tests were failing because detectProvider()
 * ignored manually registered providers in the registry. Registry check
 * must happen before env var detection to support test scenarios.
 *
 * NOTE: OPENROUTER_API_KEY is intentionally NOT detected here. The Wave-0
 * implementation has no OpenRouter adapter — auto-detecting it would return
 * "openrouter" which is absent from the provider registry and produces a
 * confusing "provider not found" crash instead of the clear "no supported
 * provider detected" error below.
 * TODO(Wave 3 / Contract 2): restore OpenRouter once a base-URL-aware adapter exists.
 *
 * @returns The detected ProviderId
 * @throws WeftError(PROVIDER_ERROR) if no supported API keys are found
 */
export function detectProvider(): ProviderId {
  // PREVENTION: Check registry first for test mocks and manual registration
  // Fixed: 2026-01-27 - Tests were failing because detectProvider()
  // ignored manually registered providers in the registry
  const defaultProvider = providerRegistry.getDefault();
  if (defaultProvider) {
    return defaultProvider.id as ProviderId;
  }

  // Fall back to environment variable detection.
  // OPENROUTER_API_KEY is intentionally excluded — no adapter exists yet.
  // TODO(Wave 3 / Contract 2): restore OpenRouter once a base-URL-aware adapter exists.
  const keys = {
    openai: process.env.OPENAI_API_KEY,
    anthropic: process.env.ANTHROPIC_API_KEY,
    google: process.env.GOOGLE_GENERATIVE_AI_API_KEY,
  };

  const foundKeys = Object.entries(keys).filter(([_, value]) => !!value);

  if (foundKeys.length === 0) {
    throw new WeftError({
      code: "PROVIDER_ERROR",
      why: "No AI provider API keys found in environment variables.",
      fix: {
        description: "Set at least one provider API key in your environment.",
        docsUrl: "https://github.com/weft-ai/weft-core#provider-setup",
      },
      example: [
        "# .env",
        "OPENAI_API_KEY=sk-proj-...",
        "# or ANTHROPIC_API_KEY=sk-ant-...",
        "# or GOOGLE_GENERATIVE_AI_API_KEY=AIza...",
      ].join("\n"),
    });
  }

  if (process.env.NODE_ENV === "production" && foundKeys.length > 1) {
    console.warn(
      `[Weft] Multiple AI provider keys found: ${foundKeys.map(([k]) => k).join(", ")}. ` +
        `Defaulting to priority: ${foundKeys[0][0]}.`,
    );
  }

  // Priority logic
  if (keys.openai) return "openai";
  if (keys.anthropic) return "anthropic";
  if (keys.google) return "google";

  // Should not be reachable due to check above
  return foundKeys[0][0] as ProviderId;
}

/**
 * Resolve model/quality overrides injected by .model() and .quality() operators.
 *
 * Priority: explicit options > context extensions > heuristics
 *
 * 📝 BUILD[Weft-algebra-level3]: Bridges AgentUnit context injection to model selection
 *
 * @param ctx - AgentContext (or any object with extensions)
 * @returns Partial AIOptions with model/quality from context, or empty
 */
export function resolveModelFromContext(ctx?: {
  extensions?: Record<string, unknown>;
}): Pick<AIOptions, "model" | "quality"> {
  const overrides: Pick<AIOptions, "model" | "quality"> = {};
  if (ctx?.extensions?.__Weft_model) {
    overrides.model = ctx.extensions.__Weft_model as string;
  }
  if (ctx?.extensions?.__Weft_quality) {
    overrides.quality = ctx.extensions.__Weft_quality as "high" | "fast";
  }
  return overrides;
}

/**
 * Resolve the active provider's model table, falling back to OpenAI defaults.
 *
 * Accepts an already-resolved `providerId` from the call site (ai.ts / streaming.ts)
 * so that the model table is always keyed off the SAME provider that will actually
 * execute the request. Falls back to detectProvider() only when no providerId is
 * threaded in (e.g. when selectModelForTask is called directly in tests or from
 * AgentUnit operators without a resolved context).
 *
 * This function is intentionally side-effect-free (read-only registry/env access).
 *
 * @param resolvedProviderId - Already-resolved provider ID from the call site, or
 *   undefined to fall back to detectProvider().
 */
function resolveProviderModelDefaults(resolvedProviderId?: string): {
  high: string;
  fast: string;
  default: string;
} {
  // Prefer the caller-supplied provider so model IDs always agree with the executor.
  const id = resolvedProviderId ?? (() => {
    try {
      return detectProvider();
    } catch {
      return undefined;
    }
  })();

  return (id && PROVIDER_MODEL_DEFAULTS[id]) ? PROVIDER_MODEL_DEFAULTS[id] : PROVIDER_MODEL_DEFAULTS.openai;
}

/**
 * Selects an appropriate model for a given task/prompt.
 *
 * Priority ordering (H4-corrected + H6-threaded — supersedes Wave-0 Contract 1 draft):
 * 1. Call-site explicit model (options.model, includes .model() override via resolveModelFromContext).
 * 2. Global config model set via Weft.configure({ model }) — beats heuristics so a configured
 *    Anthropic/Google model is not silently overridden by an OpenAI heuristic ID.
 * 3. Quality heuristics (options.quality, prompt complexity) — keyed off resolvedProviderId
 *    (H6 fix). The ALREADY-RESOLVED provider from ai.ts/streaming.ts is threaded in so the
 *    model table is always consistent with the executor. Falls back to detectProvider() when
 *    no providerId is given (direct callers, AgentUnit operators, tests).
 * 4. Provider-aware default (OpenAI fallback when no provider is configured).
 *
 * Rationale for heuristic fix (H4): previously heuristics returned hardcoded OpenAI
 * IDs ("gpt-4o", "gpt-4o-mini") even when the active provider was Anthropic or Google,
 * causing API failures at the provider. Heuristics now call resolveProviderModelDefaults()
 * which maps the active provider → its canonical model family.
 *
 * Rationale for threading fix (H6): H4's resolveProviderModelDefaults() called
 * detectProvider() independently inside selectModelForTask. If ai.ts resolved the provider
 * as Anthropic (via options.provider override) but detectProvider() would return OpenAI
 * (from registry/env), selectModelForTask still returned gpt-4o and sent it to Anthropic.
 * Threading the already-resolved providerId closes this gap.
 *
 * @param prompt - The user prompt or task description
 * @param options - Optional generation options (may include context-injected overrides)
 * @param resolvedProviderId - The ALREADY-RESOLVED provider ID from the call site (ai.ts /
 *   streaming.ts). When supplied, model heuristics key off this provider. When omitted,
 *   falls back to detectProvider() for backwards-compatible direct callers.
 * @returns The selected model name
 */
export function selectModelForTask(
  prompt: string,
  options?: AIOptions,
  resolvedProviderId?: string,
): string {
  // 1. Explicit call-site model (includes .model() override via resolveModelFromContext)
  if (options?.model) {
    return options.model;
  }

  // 2. Global config model — set via Weft.configure({ model }).
  // Must precede heuristics: heuristics previously emitted OpenAI-specific IDs that
  // break non-OpenAI providers. The globally configured model is provider-aware.
  const globalModel = getGlobalConfig().model;
  if (globalModel) {
    return globalModel;
  }

  // 3. Quality heuristics — keyed off the already-resolved provider (H6 fix).
  // Pass resolvedProviderId so the model table matches the executor, not whatever
  // detectProvider() would independently return.
  const providerDefaults = resolveProviderModelDefaults(resolvedProviderId);

  if (options?.quality === "high") {
    return providerDefaults.high;
  }
  if (options?.quality === "fast") {
    return providerDefaults.fast;
  }

  // 3b. Complexity heuristic — uses provider-aware "high" model.
  const isComplex =
    prompt.length > 500 ||
    /\b(analyze|complex|reason|think|evaluate|summarize|extract)\b/i.test(
      prompt,
    );

  if (isComplex) {
    return providerDefaults.high;
  }

  // 4. Provider-aware default.
  return providerDefaults.default;
}
