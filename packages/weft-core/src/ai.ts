/**
 * @fileoverview Core ai() function for weft-core
 * @description The primary entry point for AI generation in Weft.
 */

import type { z } from "zod";
import { createAgent } from "./agent/agent";
// ⚠️ FIX-GUARD[FP-CONSENSUS-ZOMBIE-DELETED-20260313]: Removed import of
// consensus.ts — it had incompatible Vote/ConsensusResult types vs types.ts.
// AgentUnit uses operators.ts consensus (createConsensusComputation) instead.
import { WeftError } from "./errors";
import { getInitPromise, clearInitPromise } from "./globalConfig";
import { parallel } from "./parallel";
import { redactErrorMessage, safeCause } from "./providers/redact";
import type { AIOptions as BaseAIOptions } from "./providers/auto";
import { detectProvider, selectModelForTask } from "./providers/auto";
import type { AIMessage, AIRequest } from "./providers/interface";
import { providerRegistry } from "./providers/registry";
import type { InferOutput } from "./schema";
import { stream } from "./streaming";
import { type Trace, type TraceRedactor, traceManager } from "./trace";

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
  // Await the deferred provider bootstrap enqueued by Weft.configure().
  // See OQ-1 resolution in wave-0-design.md: configure() is void/synchronous;
  // the async adapter registration is settled here before the first execution.
  const initP = getInitPromise();
  if (initP) {
    await initP;
    clearInitPromise();
  }

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

    // 2. Select model — thread the already-resolved providerId so quality heuristics
    // key off the same provider that will execute the request (H6 fix).
    const model = selectModelForTask(prompt, options, providerId);

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

    // Defense-in-depth: a provider SDK error could escape the adapter catch
    // blocks and reach this backstop carrying the API key in its message or in
    // request-header objects on the raw error. We have no apiKey reference here,
    // so we cannot string-redact a specific key — but routing the cause through
    // safeCause() still DROPS the secret-bearing raw SDK object (returning a flat
    // key-free summary), which closes the util.inspect/.cause leak vector.
    // Provider adapters already redact the key from their own messages before
    // re-throwing as WeftError (handled above), so a raw provider message only
    // reaches here for errors that never passed through an adapter.
    const message =
      error instanceof Error
        ? redactErrorMessage(undefined, error)
        : "An unknown error occurred during AI generation.";

    throw new WeftError({
      code: "UNKNOWN_ERROR",
      message,
      action: "Check the error cause and context for more details.",
      cause: safeCause(undefined, error),
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
  /**
   * Run `fn` inside a trace scope and return its result together with every
   * trace recorded during its execution. Use this for per-invocation trace
   * capture in concurrent hosts (Convex actions, HTTP handlers) — the
   * broadcast `onTrace` subscription pattern cross-wires between concurrent
   * calls in the same process.
   */
  withScope: <T>(
    fn: () => Promise<T>,
  ) => Promise<{ result: T; traces: Trace[] }>;
  /**
   * Install a redaction hook applied to every trace before storage, broadcast,
   * and downstream forwarding (including the activity-middleware path). Pass
   * `null` to remove a previously installed hook.
   *
   * Without a redactor, `Trace.prompt` and `Trace.response` store the full
   * content. Install a redactor to truncate or strip sensitive data.
   *
   * @example
   * ai.setRedactor(({ prompt, response }) => ({
   *   prompt: prompt.slice(0, 200),
   *   response: response.slice(0, 200),
   * }));
   */
  setRedactor: (redactor: TraceRedactor | null) => void;
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
    withScope: <T>(fn: () => Promise<T>) => traceManager.withScope(fn),
    setRedactor: (redactor: TraceRedactor | null) =>
      traceManager.setRedactor(redactor),
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
