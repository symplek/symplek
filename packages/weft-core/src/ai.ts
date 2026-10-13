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
import { toJsonSchema } from "./jsonSchema";
import { awaitInit } from "./globalConfig";
import { parallel } from "./parallel";
import { redactErrorMessage, safeCause } from "./providers/redact";
import type { AIOptions as BaseAIOptions } from "./providers/auto";
import { selectModelForTask } from "./providers/auto";
import type { AIMessage, AIRequest } from "./providers/interface";
import { checkProviderAnswer, resolveProvider } from "./providers/call";
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
 * List prices in USD per million tokens (input, output) for models the
 * default table in providers/auto.ts can select. The Claude rates are
 * Anthropic's published prices as of 2026-10 (Haiku 5.5 at its rate for
 * prompts up to 100K tokens); the OpenAI rates are carried over from the
 * previous table and were not re-checked. Only exact model ids are listed: a
 * guess presented as a cost is worse than no figure, so any other model,
 * including the Gemini defaults, gets no estimate.
 */
const TOKEN_RATES_PER_1M: Record<string, readonly [number, number]> = {
  "gpt-4o": [2.5, 10],
  "gpt-4o-mini": [0.15, 0.6],
  "claude-opus-5-5": [4, 20],
  "claude-sonnet-5-5": [2, 10],
  "claude-haiku-5-5": [0.1, 0.5],
};

/**
 * Estimate what a request cost from static list prices. Returns undefined for
 * a model with no known price. Used for the debug log line only.
 */
function estimateTokenCost(
  model: string,
  inputTokens: number,
  outputTokens: number,
): string | undefined {
  const rates = TOKEN_RATES_PER_1M[model];
  if (!rates) return undefined;
  const cost =
    (inputTokens / 1_000_000) * rates[0] + (outputTokens / 1_000_000) * rates[1];
  return cost.toFixed(4);
}

/**
 * The instruction that tells a model which JSON shape `ai()` will validate
 * its reply against. Provider JSON modes guarantee syntax only, and OpenAI's
 * rejects a request whose messages never mention JSON, so this text is what
 * makes a schema-bearing call work on every provider.
 */
function schemaInstruction(schema: z.ZodType): string {
  const preamble =
    "Reply with a single JSON value and nothing else: no prose, no code fences.";
  try {
    const jsonSchema = toJsonSchema(schema);
    return `${preamble} It must validate against this JSON Schema:\n${JSON.stringify(jsonSchema)}`;
  } catch {
    // A schema the converter cannot describe still gets the JSON-only rule;
    // validation afterwards reports any mismatch.
    return preamble;
  }
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
  await awaitInit();

  const startTime = Date.now();
  try {
    // 1. Resolve the provider: the one asked for, or the detected one.
    const { provider, providerId } = await resolveProvider(options?.provider);

    // 2. Select model — thread the already-resolved providerId so quality heuristics
    // key off the same provider that will execute the request (H6 fix).
    const model = selectModelForTask(prompt, options, providerId);

    // 3. Prepare messages. When a schema is given the model has to be told
    // what shape to produce: the reply is validated against the schema below,
    // and a model that was never shown the fields cannot satisfy it. The
    // instruction travels in one system message, since adapters forward a
    // single system prompt.
    const messages: AIMessage[] = [];
    const system = [
      options?.system,
      options?.schema ? schemaInstruction(options.schema) : undefined,
    ]
      .filter(Boolean)
      .join("\n\n");
    if (system) {
      messages.push({ role: "system", content: system });
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
        `[weft] POST ${model} (${duration}ms) / tokens: ${inputTokens} in / ${outputTokens} out${estimatedCost ? ` / cost: ~$${estimatedCost}` : ""}\n`,
      );
    }

    // A refusal, or an output limit spent before any text, is not a reply.
    // Returning "" for either would read as a successful empty answer.
    checkProviderAnswer(
      response.finishReason,
      Boolean(response.text),
      providerId,
      model,
    );

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
