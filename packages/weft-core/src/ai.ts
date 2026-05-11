/**
 * @fileoverview Core ai() function for @weft/core
 * @description The primary entry point for AI generation in Weft.
 */

import type { z } from "zod";
import { createAgent } from "./agent/agent";
// ⚠️ FIX-GUARD[FP-CONSENSUS-ZOMBIE-DELETED-20260313]: Removed import of
// consensus.ts — it had incompatible Vote/ConsensusResult types vs types.ts.
// AgentUnit uses operators.ts consensus (createConsensusComputation) instead.
import { WeftError } from "./errors";
import { parallel } from "./parallel";
import type { AIOptions as BaseAIOptions } from "./providers/auto";
import { detectProvider, selectModelForTask } from "./providers/auto";
import type { AIMessage, AIRequest } from "./providers/interface";
import { providerRegistry } from "./providers/registry";
import type { InferOutput } from "./schema";
import { stream } from "./streaming";
import { type Trace, traceManager } from "./trace";

/**
 * Extended options for the ai() function.
 */
export interface AIOptions<T extends z.ZodType = any>
  extends Omit<BaseAIOptions, "model" | "quality"> {
  /** Explicit model name to use */
  model?: string;
  /** Desired quality level */
  quality?: "high" | "fast";
  /** Optional Zod schema for structured output */
  schema?: T;
  /** Whether to fail fast in parallel execution (default: true) */
  failFast?: boolean;
  /** System prompt to prepend */
  system?: string;
}

/**
 * Result of an AI generation.
 * If a schema is provided, the result will be the parsed object.
 * Otherwise, it will be the generated string.
 */
export type AIResult<T extends z.ZodType = any> = T extends z.ZodType
  ? InferOutput<T>
  : string;

/**
 * Basic prompt object for parallel execution.
 */
export interface AIPrompt<T extends z.ZodType = any> {
  prompt: string;
  options?: AIOptions<T>;
}

/**
 * Estimate the cost of a token request using static per-model rates.
 * Rates are approximate and may not reflect current pricing.
 *
 * @param model - The model name used for the request
 * @param inputTokens - Number of input/prompt tokens
 * @param outputTokens - Number of output/completion tokens
 * @returns Cost string formatted to 4 decimal places (e.g. "0.0023")
 */
function estimateTokenCost(
  model: string,
  inputTokens: number,
  outputTokens: number,
): string {
  // Rates in USD per 1M tokens (input / output)
  let inputRatePer1M = 2.0; // fallback
  let outputRatePer1M = 2.0; // fallback

  if (model.includes("gpt-4o-mini")) {
    inputRatePer1M = 0.15;
    outputRatePer1M = 0.6;
  } else if (model.includes("gpt-4o")) {
    inputRatePer1M = 2.5;
    outputRatePer1M = 10.0;
  } else if (
    model.includes("claude-3-5-sonnet") ||
    model.includes("claude-3.5-sonnet")
  ) {
    inputRatePer1M = 3.0;
    outputRatePer1M = 15.0;
  } else if (model.includes("claude")) {
    // Generic claude fallback
    inputRatePer1M = 3.0;
    outputRatePer1M = 15.0;
  } else if (model.includes("gemini")) {
    inputRatePer1M = 1.25;
    outputRatePer1M = 5.0;
  } else {
    // Unknown model: rough fallback ~$0.002/1K tokens total
    const totalTokens = inputTokens + outputTokens;
    return (totalTokens * 0.000002).toFixed(4);
  }

  const cost =
    (inputTokens / 1_000_000) * inputRatePer1M +
    (outputTokens / 1_000_000) * outputRatePer1M;
  return cost.toFixed(4);
}

/**
 * The core ai() function implementation.
 */
async function aiImplementation<T extends z.ZodType = any>(
  prompt: string,
  options?: AIOptions<T>,
): Promise<AIResult<T>> {
  const startTime = Date.now();
  try {
    // 1. Detect provider if not specified
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
    const model = selectModelForTask(prompt, options);

    // 3. Prepare messages
    const messages: AIMessage[] = [];
    if (options?.system) {
      messages.push({ role: "system", content: options.system });
    }
    messages.push({ role: "user", content: prompt });

    // 4. Handle structured output if schema is provided
    // Destructure out Weft-specific fields so they are not forwarded to provider SDKs
    const {
      schema: _schema,
      failFast: _failFast,
      quality: _quality,
      system: _system,
      model: _model,
      provider: _provider,
      ...providerOpts
    } = options ?? {};
    const requestOptions: Omit<AIRequest, "model" | "messages"> = {
      ...providerOpts,
      ...(options?.schema && provider.capabilities.structuredOutput
        ? { responseFormat: { type: "json_object" as const } }
        : {}),
    };

    // 5. Generate response
    const response = await provider.generate({
      model,
      messages,
      ...requestOptions,
    });

    // 6. Record trace
    const duration = Date.now() - startTime;
    const inputTokens = response.usage?.promptTokens || 0;
    const outputTokens = response.usage?.completionTokens || 0;
    traceManager.record({
      // Non-cryptographic ID — trace IDs are for debugging only, not security tokens
      id: Math.random().toString(36).substring(7),
      duration,
      provider: providerId,
      model,
      prompt,
      response: response.text,
      tokens: {
        input: inputTokens,
        output: outputTokens,
        total: response.usage?.totalTokens || 0,
      },
      timestamp: startTime,
    });

    // 6b. Debug logging — written to stderr so it doesn't pollute stdout pipelines
    if (traceManager.debug) {
      const estimatedCost = estimateTokenCost(model, inputTokens, outputTokens);
      process.stderr.write(
        `[weft] POST ${model} (${duration}ms) / tokens: ${inputTokens} in / ${outputTokens} out / cost: ~$${estimatedCost}\n`,
      );
    }

    // 7. Process result
    if (options?.schema) {
      let text = response.text.trim();

      // Basic cleanup for common AI "hallucinations" like markdown code blocks
      if (text.startsWith("```json")) {
        text = text.replace(/^```json\n?/, "").replace(/\n?```$/, "");
      } else if (text.startsWith("```")) {
        text = text.replace(/^```\n?/, "").replace(/\n?```$/, "");
      }

      try {
        const parsed = JSON.parse(text);
        return options.schema.parse(parsed) as AIResult<T>;
      } catch (error) {
        throw new WeftError({
          code: "INVALID_SCHEMA",
          message: "Failed to parse AI response into the provided schema.",
          action:
            "Check if the model is capable of generating JSON and if the prompt is clear.",
          cause: error,
          context: {
            text: response.text,
            schema:
              "description" in options.schema
                ? String(
                    (options.schema as { description?: string }).description ??
                      "ZodSchema",
                  )
                : "ZodSchema",
          },
        });
      }
    }

    return response.text as AIResult<T>;
  } catch (error) {
    if (error instanceof WeftError) throw error;

    throw new WeftError({
      code: "UNKNOWN_ERROR",
      message:
        error instanceof Error
          ? error.message
          : "An unknown error occurred during AI generation.",
      action: "Check the error cause and context for more details.",
      cause: error,
    });
  }
}

// ai.consensus removed — see FIX-GUARD[FP-CONSENSUS-ZOMBIE-DELETED-20260313]

/**
 * Typed interface for the exported ai() function and its attached utilities.
 * Preserves full generic inference for callers — `ai(prompt, { schema })` returns
 * the inferred Zod output type, not `any`.
 */
export interface AIFunction {
  <T extends z.ZodType = any>(
    prompt: string,
    options?: AIOptions<T>,
  ): Promise<AIResult<T>>;
  /** Creates an agent with the given configuration. */
  agent: typeof createAgent;
  /** Parallel execution of multiple AI prompts. @deprecated Use AgentUnit.zipAll() */
  all: typeof parallel;
  /** Stream an AI response. */
  stream: typeof stream;
  /** Enable or disable debug tracing. */
  debug: boolean;
  /** Returns the last recorded trace. */
  lastTrace: () => Trace | undefined;
  /** Register a trace callback. Returns an unsubscribe function. */
  onTrace: (callback: (trace: Trace) => void) => () => void;
}

/**
 * The core ai() function with tracing and utilities.
 */
export const ai: AIFunction = Object.assign(
  aiImplementation as unknown as AIFunction,
  {
    agent: createAgent,
    all: parallel,
    stream,
    lastTrace: () => traceManager.lastTrace(),
    onTrace: (callback: (trace: Trace) => void) =>
      traceManager.onTrace(callback),
  },
);

Object.defineProperty(ai, "debug", {
  get: () => traceManager.debug,
  set: (value: boolean) => {
    traceManager.debug = value;
  },
  enumerable: true,
  configurable: true,
});
