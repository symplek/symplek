/**
 * @module executor - Internal agent execution loop
 * @description Drives the generate → tool-call → respond cycle.
 *   zodSchemaToJsonSchema() uses only public Zod v3 APIs (instanceof / .shape /
 *   .unwrap). executeLoop() is the real multi-turn engine used by AgentUnit.loop().
 * @rules CR-402: tool loop surfaced; Anthropic role:"tool" fix must be in place first.
 * @since 1.0.0-beta.1 — CR-402: executeLoop() added
 */
import { z } from "zod";
import {
  ToolApprovalRequiredError,
} from "../interview/computations";
import { SymplekError } from "../errors";
import { DEFAULT_LOOP_OPTIONS, type LoopOptions, type StepInfo } from "../loop";
import {
  type AIMessage,
  type Provider,
  type ToolDefinition,
  detectProvider,
  providerRegistry,
  selectModelForTask,
} from "../providers";
import type { Tool, ToolApprovalPayload } from "./tool";

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
    throw new SymplekError({
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

// ─────────────────────────────────────────────────────────────────────────────
// Real multi-turn loop engine (CR-402)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Options bundle for executeLoop(). Extends LoopOptions with the tool array
 * and an optional approval gate for requiresApproval tools.
 */
export interface LoopExecuteOptions extends LoopOptions {
  /**
   * Model identifier to use for generation. Defaults to "claude-opus-4-5"
   * when not specified. Override for tests or to route to a specific model.
   */
  model?: string;
  /**
   * Optional approval callback. When a tool has requiresApproval set, this
   * callback is awaited before execution. Return true to approve (execute the
   * tool) or false to deny (skip execution and inform the LLM the tool was
   * refused). When absent and a tool requires approval, ToolApprovalRequiredError
   * is thrown — this is a configuration error, not a denial.
   */
  requireApproval?: (payload: ToolApprovalPayload) => Promise<boolean>;
}

/**
 * Drives a multi-turn LLM ↔ tool execution cycle.
 *
 * @remarks
 * One loop iteration = one call to provider.generate():
 *
 * 1. Call provider.generate() with the current message history and tool defs.
 * 2. If the response has no tool calls: append the assistant text, record the
 *    step, and stop — this is the final answer.
 * 3. If the response has tool calls:
 *    a. Append the assistant message with `toolCalls` populated so providers
 *       (e.g., Anthropic) can emit the required `tool_use` block.
 *    b. For each call: parse input through the tool's Zod schema via safeParse.
 *       A parse failure is a non-executing outcome — an error tool_result is
 *       sent to the LLM; the tool does not run and the approval gate is not
 *       reached.
 *    c. For parsed inputs: gate through requiresApproval / requireApproval.
 *    d. Execute approved calls; insert denial messages for denied ones.
 *    e. Record the step and check stopWhen.
 *    f. Continue — the NEXT iteration calls generate() with the tool results
 *       in the message history. There is no separate "feed call" within a step.
 *
 * This single-call-per-iteration design means any tool calls the model returns
 * after seeing tool results are handled by the same path (including approval),
 * closing the silent-drop hole in the former two-call-per-step design.
 *
 * @param provider - AI provider to use for generation
 * @param initialMessages - Seed conversation (system prompt + user turn)
 * @param tools - Tool definitions with execute implementations and names
 * @param options - Loop control including approval gate
 * @returns Final text, step history, and execution metadata
 *
 * @throws {ToolApprovalRequiredError} When a requiresApproval tool is
 *   encountered but no requireApproval callback is configured.
 */
export async function executeLoop(
  provider: Provider,
  initialMessages: AIMessage[],
  tools: Array<Tool & { name: string }>,
  options: LoopExecuteOptions = {},
): Promise<AgentResult> {
  const startTime = Date.now();
  const maxSteps = options.maxSteps ?? DEFAULT_LOOP_OPTIONS.maxSteps;
  const messages: AIMessage[] = [...initialMessages];
  const steps: StepInfo[] = [];
  let totalTokens = 0;
  let totalToolCalls = 0;

  // Build provider-neutral ToolDefinition[] once.
  const toolDefs: ToolDefinition[] = tools.map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema:
      zodSchemaToJsonSchema(t.parameters) ??
      ({ type: "object", properties: {}, required: [] } as Record<string, unknown>),
  }));

  // Index tools by name for O(1) lookup during execution.
  const toolsByName = new Map<string, Tool & { name: string }>(
    tools.map((t) => [t.name, t]),
  );

  // Model defaults to the latest Anthropic workhorse; callers override via options.model.
  const model = options.model ?? "claude-opus-4-5";

  for (let stepNumber = 1; stepNumber <= maxSteps; stepNumber++) {
    const response = await provider.generate({
      model,
      messages,
      tools: toolDefs.length > 0 ? toolDefs : undefined,
    });

    totalTokens += response.usage?.totalTokens ?? 0;

    const providerToolCalls = response.toolCalls ?? [];

    // No tool calls → final text response; record and stop.
    if (providerToolCalls.length === 0) {
      messages.push({ role: "assistant", content: response.text });
      steps.push({
        stepNumber,
        messages: [...messages],
        toolResults: [],
        lastResponse: response.text,
      });
      break;
    }

    // Tool calls present. Include the `toolCalls` array on the assistant message
    // so provider transforms (e.g. Anthropic) can emit the required `tool_use`
    // content block that must precede each `tool_result` block. Without it, the
    // provider receives an orphaned tool_result and rejects the request.
    messages.push({
      role: "assistant",
      content: response.text || "",
      toolCalls: providerToolCalls,
    });

    const toolResults: unknown[] = [];

    for (const call of providerToolCalls) {
      totalToolCalls++;

      const impl = toolsByName.get(call.name);
      if (!impl) {
        messages.push({
          role: "tool",
          content: `Error: tool "${call.name}" is not registered`,
          toolCallId: call.id,
        });
        toolResults.push({ error: `tool "${call.name}" not found` });
        continue;
      }

      // Parse input through the tool's Zod schema BEFORE any approval or
      // execution decision. A single authoritative parse result prevents the
      // approval predicate and executor from interpreting the same raw value
      // differently (e.g. `{delete:"false"}` — predicate sees a falsy string,
      // executor sees a truthy string — both operating on an unparsed value).
      const parseResult = impl.parameters.safeParse(call.input);
      if (!parseResult.success) {
        const errMsg = parseResult.error.message;
        messages.push({
          role: "tool",
          content: `Tool input validation failed: ${errMsg}`,
          toolCallId: call.id,
        });
        toolResults.push({ error: `parse_failure: ${errMsg}` });
        continue;
      }
      const parsedInput = parseResult.data as z.infer<typeof impl.parameters>;

      // Approval check uses the parsed (schema-coerced) input.
      const needsApproval =
        typeof impl.requiresApproval === "function"
          ? impl.requiresApproval(parsedInput)
          : (impl.requiresApproval ?? false);

      if (needsApproval) {
        const approvalPayload: ToolApprovalPayload = {
          type: "tool-approval",
          toolCallId: call.id,
          toolName: call.name,
          input: parsedInput,
        };

        if (!options.requireApproval) {
          throw new ToolApprovalRequiredError(approvalPayload);
        }

        const approved = await options.requireApproval(approvalPayload);

        if (!approved) {
          messages.push({
            role: "tool",
            content: "Tool execution was denied by the user.",
            toolCallId: call.id,
          });
          toolResults.push({ denied: true, toolCallId: call.id });
          continue;
        }
      }

      // Execute with the schema-validated input.
      try {
        const result = await impl.execute(parsedInput);
        const resultText =
          typeof result === "string" ? result : JSON.stringify(result);
        messages.push({
          role: "tool",
          content: resultText,
          toolCallId: call.id,
        });
        toolResults.push(result);
      } catch (execErr: unknown) {
        const errMsg =
          execErr instanceof Error ? execErr.message : String(execErr);
        messages.push({
          role: "tool",
          content: `Tool execution error: ${errMsg}`,
          toolCallId: call.id,
        });
        toolResults.push({ error: errMsg });
      }
    }

    // Record the tool-execution step. The `lastResponse` field is not populated
    // here — the LLM's reaction text arrives in the next iteration. Consumers
    // that need the final text should use result.text (derived from the last
    // step's lastResponse, which is always a text-only step).
    const currentStep: StepInfo = {
      stepNumber,
      messages: [...messages],
      toolResults,
      lastResponse: undefined,
    };
    steps.push(currentStep);

    if (options.stopWhen?.(currentStep)) {
      break;
    }
    // Continue: next iteration calls generate() with tool results in history.
    // If the model's next response also has tool calls, they are handled by
    // the same path — including the approval gate.
  }

  const lastStep = steps[steps.length - 1];
  return {
    text: lastStep?.lastResponse ?? "",
    steps,
    toolCallCount: totalToolCalls,
    metadata: {
      duration: Date.now() - startTime,
      totalTokens,
    },
  };
}
