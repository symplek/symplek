/**
 * @fileoverview Auto-detection and model selection for weft-core
 * @description Implements automatic provider detection from environment variables and intelligent model selection.
 */

import { WeftError } from "../errors";
import { getGlobalConfig } from "../globalConfig";
import type { ProviderId } from "./interface";
import { providerRegistry } from "./registry";

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
 * Selects an appropriate model for a given task/prompt.
 *
 * Priority ordering (Codex-corrected — supersedes Wave-0 Contract 1 draft):
 * 1. Call-site explicit model (options.model, includes .model() override via resolveModelFromContext).
 * 2. Global config model set via Weft.configure({ model }) — beats heuristics so a configured
 *    Anthropic/Google model is not silently overridden by an OpenAI heuristic ID.
 * 3. Quality heuristics (options.quality, prompt complexity).
 * 4. Hardcoded default ("gpt-4o-mini").
 *
 * Rationale for order change: heuristics return hardcoded OpenAI model IDs ("gpt-4o",
 * "gpt-4o-mini"). If those IDs are forwarded to a configured Anthropic or Google provider
 * the request fails at the provider's API. The globally configured model is provider-aware
 * (it was set by the same caller who configured the provider), so it must win over heuristics.
 *
 * @param prompt - The user prompt or task description
 * @param options - Optional generation options (may include context-injected overrides)
 * @returns The selected model name
 */
export function selectModelForTask(
  prompt: string,
  options?: AIOptions,
): string {
  // 1. Explicit call-site model (includes .model() override via resolveModelFromContext)
  if (options?.model) {
    return options.model;
  }

  // 2. Global config model — set via Weft.configure({ model }).
  // Must precede heuristics: heuristics emit OpenAI-specific IDs that break non-OpenAI providers.
  const globalModel = getGlobalConfig().model;
  if (globalModel) {
    return globalModel;
  }

  // 3. Explicit quality choice (includes .quality() override via resolveModelFromContext)
  if (options?.quality === "high") {
    return "gpt-4o";
  }
  if (options?.quality === "fast") {
    return "gpt-4o-mini";
  }

  // 3b. Complexity heuristic — OpenAI model IDs, only safe when no globalModel is set.
  const isComplex =
    prompt.length > 500 ||
    /\b(analyze|complex|reason|think|evaluate|summarize|extract)\b/i.test(
      prompt,
    );

  if (isComplex) {
    return "gpt-4o";
  }

  // 4. Hardcoded default
  return "gpt-4o-mini";
}
