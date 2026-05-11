/**
 * @fileoverview Auto-detection and model selection for @weft/core
 * @description Implements automatic provider detection from environment variables and intelligent model selection.
 */

import { WeftError } from "../errors";
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
 * 2. Environment variables: OPENROUTER → OPENAI → ANTHROPIC → GOOGLE
 *
 * PREVENTION: Check registry first for test mocks and manual registration
 * Fixed: 2026-01-27 - Tests were failing because detectProvider()
 * ignored manually registered providers in the registry. Registry check
 * must happen before env var detection to support test scenarios.
 *
 * @returns The detected ProviderId
 * @throws Error if no API keys are found
 */
export function detectProvider(): ProviderId {
  // PREVENTION: Check registry first for test mocks and manual registration
  // Fixed: 2026-01-27 - Tests were failing because detectProvider()
  // ignored manually registered providers in the registry
  const defaultProvider = providerRegistry.getDefault();
  if (defaultProvider) {
    return defaultProvider.id as ProviderId;
  }

  // Fall back to environment variable detection
  const keys = {
    openrouter: process.env.OPENROUTER_API_KEY,
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
        "# or OPENROUTER_API_KEY=sk-or-...",
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
  if (keys.openrouter) return "openrouter";
  if (keys.openai) return "openai";
  if (keys.anthropic) return "anthropic";
  if (keys.google) return "google";

  // Should not be reachable due to check above
  return foundKeys[0][0];
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
 * Priority ordering:
 * 1. If options.model is provided (explicit or from context), use it.
 * 2. If options.quality is set (explicit or from context), map to model.
 * 3. Heuristics based on prompt complexity.
 * 4. Default to fast model.
 *
 * @param prompt - The user prompt or task description
 * @param options - Optional generation options (may include context-injected overrides)
 * @returns The selected model name
 */
export function selectModelForTask(
  prompt: string,
  options?: AIOptions,
): string {
  // 1. Explicit model choice (includes .model() override via resolveModelFromContext)
  if (options?.model) {
    return options.model;
  }

  // 2. Explicit quality choice (includes .quality() override via resolveModelFromContext)
  if (options?.quality === "high") {
    return "gpt-4o";
  }
  if (options?.quality === "fast") {
    return "gpt-4o-mini";
  }

  // 3. Heuristics
  const isComplex =
    prompt.length > 500 ||
    /\b(analyze|complex|reason|think|evaluate|summarize|extract)\b/i.test(
      prompt,
    );

  if (isComplex) {
    return "gpt-4o";
  }

  // 4. Default
  return "gpt-4o-mini";
}
