/**
 * @module executor - Internal agent execution loop
 * @description Drives the generate → tool-call → respond cycle for executeAgent().
 * @rules Tool-parameter serialisation uses only public Zod v3 APIs (instanceof / .shape /
 *   .unwrap). When tool calling is fully wired, replace zodSchemaToJsonSchema() with
 *   the `zod-to-json-schema` package (zod-version-safe, handles every Zod type).
 */
import { z } from "zod";
import { WeftError } from "../errors";
import { DEFAULT_LOOP_OPTIONS, type LoopOptions, type StepInfo } from "../loop";
import {
  type AIMessage,
  detectProvider,
  providerRegistry,
  selectModelForTask,
} from "../providers";
import type { Tool } from "./tool";

// ─────────────────────────────────────────────────────────────────────────────
// Zod → JSON Schema conversion (public API only, Zod v3-safe)
// ─────────────────────────────────────────────────────────────────────────────

/** JSON Schema representation of a single field type. Exported for unit testing. */
export type JsonSchemaType =
  | { type: "string" }
  | { type: "number" }
  | { type: "boolean" }
  | { type: "object"; properties: Record<string, JsonSchemaType>; required: string[] };

/**
 * Convert a single Zod leaf type to its JSON Schema representation.
 * Uses only public Zod v3 APIs: instanceof checks, ZodOptional.unwrap().
 * Returns `undefined` for unrecognised types rather than silently emitting
 * a broken schema — callers must guard on undefined.
 *
 * NOTE: This handles only the primitive types needed for the current
 * no-op tool-parameter path. When tool calling is fully wired, replace
 * with `zod-to-json-schema` (npm: zod-to-json-schema >=3.0.0) which
 * handles the full Zod type surface including unions, arrays, literals, etc.
 */
function zodFieldToJsonSchema(field: z.ZodTypeAny): JsonSchemaType | undefined {
  // Unwrap optional wrappers first (ZodOptional.unwrap() is public Zod v3 API)
  const unwrapped =
    field instanceof z.ZodOptional ? field.unwrap() : field;

  if (unwrapped instanceof z.ZodString) return { type: "string" };
  if (unwrapped instanceof z.ZodNumber) return { type: "number" };
  if (unwrapped instanceof z.ZodBoolean) return { type: "boolean" };
  if (unwrapped instanceof z.ZodObject) return zodObjectToJsonSchema(unwrapped);

  return undefined;
}

/**
 * Convert a ZodObject schema to a JSON Schema `{ type: "object", ... }` node.
 * `schema.shape` is a public Zod v3 API (documented in the Zod README).
 */
function zodObjectToJsonSchema(
  schema: z.ZodObject<z.ZodRawShape>,
): JsonSchemaType & { type: "object" } {
  const properties: Record<string, JsonSchemaType> = {};
  const required: string[] = [];

  for (const [key, field] of Object.entries(schema.shape)) {
    const converted = zodFieldToJsonSchema(field as z.ZodTypeAny);
    if (converted !== undefined) {
      properties[key] = converted;
      // A field is required if it is NOT wrapped in ZodOptional
      if (!(field instanceof z.ZodOptional)) {
        required.push(key);
      }
    }
  }

  return { type: "object", properties, required };
}

/**
 * Top-level entry: convert a tool's Zod parameters schema to JSON Schema.
 * Returns `undefined` when the schema is not a ZodObject (unsupported root type).
 *
 * Exported for unit testing only — treat as internal API; do not import from
 * outside this package.
 */
export function zodSchemaToJsonSchema(
  parameters: z.ZodTypeAny,
): (JsonSchemaType & { type: "object" }) | undefined {
  if (parameters instanceof z.ZodObject) {
    return zodObjectToJsonSchema(parameters);
  }
  return undefined;
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

  const providerId = detectProvider();
  const provider = providerRegistry.get(providerId);
  if (!provider) {
    throw new WeftError({
      code: "PROVIDER_ERROR",
      message: `Provider "${providerId}" not found.`,
      action: "Ensure the provider is registered and the API key is set.",
    });
  }

  // Map tools to provider format if supported.
  // zodSchemaToJsonSchema() uses only public Zod v3 APIs — no ._def access.
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
      config.model || selectModelForTask(messages[messages.length - 1].content);

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
