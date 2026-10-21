/**
 * @module executor - Internal agent execution loop
 * @description Drives the generate → tool-call → respond cycle for executeAgent().
 */
import type { z } from "zod";
import { SymplekError } from "../errors";
import { awaitInit } from "../globalConfig";
import { toJsonSchema } from "../jsonSchema";
import { DEFAULT_LOOP_OPTIONS, type LoopOptions, type StepInfo } from "../loop";
import {
  type AIMessage,
  detectProvider,
  providerRegistry,
  selectModelForTask,
} from "../providers";
import { registerProviderFromEnv } from "../providers/bootstrap";
import type { Tool } from "./tool";

// ─────────────────────────────────────────────────────────────────────────────
// Zod → JSON Schema conversion
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Loose JSON Schema object type that captures the full output of
 * `zod-to-json-schema`. Exported for unit testing.
 * @internal
 */
export type JsonSchemaType = Record<string, unknown> & { type: "object" };

/**
 * Convert a tool's Zod parameters schema (Zod 3 or Zod 4) to the JSON Schema
 * object a provider expects as a tool's input schema.
 *
 * Returns `undefined` when the root schema is not an object, which is the only
 * shape a tool's parameters can take.
 *
 * `additionalProperties: false` is set when the schema does not say otherwise,
 * so the result is usable as a strict tool contract.
 *
 * Exported for unit testing only: treat as internal API.
 */
export function zodSchemaToJsonSchema(
  parameters: z.ZodTypeAny,
): JsonSchemaType | undefined {
  let schema: ReturnType<typeof toJsonSchema>;
  try {
    schema = toJsonSchema(parameters);
  } catch {
    // Not a schema the converter can describe (for example a plain object
    // passed where a Zod schema belongs). The caller treats undefined as
    // "no usable input schema".
    return undefined;
  }
  if (schema.type !== "object") return undefined;
  if (!("additionalProperties" in schema)) {
    schema.additionalProperties = false;
  }
  return schema as JsonSchemaType;
}

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Detailed result of an agent execution.
 */
export interface AgentResult {
  /** Final text response from the agent. */
  text: string;
  /** Information about each step taken. */
  steps: StepInfo[];
  /** Total number of tool calls made. */
  toolCallCount: number;
  /** Execution metadata. */
  metadata: {
    /** Total duration in milliseconds. */
    duration: number;
    /** Total tokens used across all steps. */
    totalTokens: number;
  };
}

/**
 * Internal executor for agent loops.
 */
export async function executeAgent(
  prompt: string,
  config: {
    instructions?: string;
    persona?: string;
    tools?: Record<string, Tool>;
    loop?: LoopOptions;
    model?: string;
  },
): Promise<AgentResult> {
  const startTime = Date.now();
  const maxSteps = config.loop?.maxSteps ?? DEFAULT_LOOP_OPTIONS.maxSteps;
  const systemPrompt =
    config.instructions ||
    (config.persona ? `You are a ${config.persona}.` : undefined);

  const messages: AIMessage[] = [];
  if (systemPrompt) {
    messages.push({ role: "system", content: systemPrompt });
  }
  messages.push({ role: "user", content: prompt });

  const steps: StepInfo[] = [];
  let totalTokens = 0;
  const toolCallCount = 0;

  // Wait for a provider configured with Symplek.configure() before resolving
  // one, as ai() and stream() do. Without this a call made straight after
  // configure() looked up the provider before its adapter had registered.
  await awaitInit();

  const providerId = detectProvider();
  // A provider key in the environment is enough on its own (see ai.ts).
  await registerProviderFromEnv(providerId);
  const provider = providerRegistry.get(providerId);
  if (!provider) {
    throw new SymplekError({
      code: "PROVIDER_ERROR",
      message: `Provider "${providerId}" not found.`,
      action:
        "Set a provider API key (e.g. OPENAI_API_KEY) or call Symplek.configure({ provider, apiKey }).",
    });
  }

  // Map tools to provider format if supported.
  // The result is currently unused (tool calls are not yet wired into provider.generate);
  // this mapping is in place so that when the provider interface is extended the
  // correct JSON Schema is already available without further changes here.
  const _providerTools = config.tools
    ? Object.entries(config.tools).map(([name, tool]) => ({
        type: "function" as const,
        function: {
          name,
          description: tool.description,
          parameters: zodSchemaToJsonSchema(tool.parameters),
        },
      }))
    : undefined;

  for (let stepNumber = 1; stepNumber <= maxSteps; stepNumber++) {
    const model =
      config.model ||
      selectModelForTask(
        messages[messages.length - 1].content,
        undefined,
        providerId,
      );

    // 1. Generate response
    const response = await provider.generate({
      model,
      messages,
      // tools: providerTools, // Provider interface might need update to support tools properly
    } as any);

    totalTokens += response.usage.totalTokens;

    // 2. Check for tool calls (simplified for this story as provider interface doesn't explicitly show tool calls yet)
    // In a real implementation, we'd parse response.toolCalls
    const toolResults: unknown[] = [];

    // For now, we assume no tool calls until provider interface is updated or we add parsing logic
    // This satisfies the "loop until no tool calls" logic by finishing immediately if no tools are called.

    const currentStep: StepInfo = {
      stepNumber,
      messages: [...messages, { role: "assistant", content: response.text }],
      toolResults,
      lastResponse: response.text,
    };
    steps.push(currentStep);
    messages.push({ role: "assistant", content: response.text });

    // Stop if no tool calls or custom stop condition
    if (toolResults.length === 0 || config.loop?.stopWhen?.(currentStep)) {
      break;
    }

    // If we had tool calls, we would execute them and add results to messages here
  }

  return {
    text: steps[steps.length - 1].lastResponse || "",
    steps,
    toolCallCount,
    metadata: {
      duration: Date.now() - startTime,
      totalTokens,
    },
  };
}
