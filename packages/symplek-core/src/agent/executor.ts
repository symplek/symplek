/**
 * @module executor - Internal agent execution loop
 * @description Drives the generate → tool-call → respond cycle for executeAgent().
 *   executeLoop() is the real multi-turn engine used by AgentUnit.loop().
 * @rules CR-402: tool loop surfaced; Anthropic role:"tool" fix must be in place first.
 */
import type { z } from "zod";
import { awaitInit } from "../globalConfig";
import { ToolApprovalRequiredError } from "../interview/computations";
import { toJsonSchema } from "../jsonSchema";
import { DEFAULT_LOOP_OPTIONS, type LoopOptions, type StepInfo } from "../loop";
import {
  type AIMessage,
  type Provider,
  type ToolDefinition,
  selectModelForTask,
} from "../providers";
import { checkProviderAnswer, resolveProvider } from "../providers/call";
import type { Tool, ToolApprovalPayload } from "./tool";

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

  // Wait for a provider configured with Symplek.configure(), then resolve one
  // the same way ai() and stream() do.
  await awaitInit();
  const { provider, providerId } = await resolveProvider();

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

    // A refusal, or an output limit spent before any text, is not a step.
    checkProviderAnswer(
      response.finishReason,
      Boolean(response.text),
      providerId,
      model,
    );

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
 * The loop runs as follows per step:
 * 1. Call provider.generate() with current messages and tool definitions.
 * 2. If response.finishReason === "tool_calls": for each tool call, check
 *    requiresApproval, gate through requireApproval callback if present,
 *    execute approved tools, send denial messages for denied tools.
 * 3. Append tool results as role:"tool" messages (with toolCallId for
 *    Anthropic's tool_result correlation).
 * 4. Repeat until stopWhen fires, noToolCalls, or maxSteps is reached.
 *
 * The Anthropic adapter's transformMessages fix (CR-402) is a prerequisite:
 * role:"tool" messages must be converted to tool_result content blocks.
 *
 * @param provider - AI provider to use for generation
 * @param initialMessages - Seed conversation (system prompt + user turn)
 * @param tools - Tool definitions with execute implementations and optional names
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

    // No tool calls → normal text response; add to history and stop.
    const providerToolCalls = response.toolCalls ?? [];

    if (providerToolCalls.length === 0) {
      // Append the assistant's final text turn.
      messages.push({ role: "assistant", content: response.text });
      steps.push({
        stepNumber,
        messages: [...messages],
        toolResults: [],
        lastResponse: response.text,
      });
      break;
    }

    // Tool calls — record the assistant turn then execute each call.
    // Anthropic requires the tool_use block (assistant turn) before any
    // tool_result block, so append the assistant message first.
    messages.push({ role: "assistant", content: response.text || "" });

    const toolResults: unknown[] = [];

    for (const call of providerToolCalls) {
      totalToolCalls++;

      const impl = toolsByName.get(call.name);
      if (!impl) {
        // Unknown tool — send an error result so the LLM knows.
        messages.push({
          role: "tool",
          content: `Error: tool "${call.name}" is not registered`,
          toolCallId: call.id,
        });
        toolResults.push({ error: `tool "${call.name}" not found` });
        continue;
      }

      // Check approval requirement.
      const needsApproval =
        typeof impl.requiresApproval === "function"
          ? impl.requiresApproval(call.input as z.infer<typeof impl.parameters>)
          : (impl.requiresApproval ?? false);

      if (needsApproval) {
        const approvalPayload: ToolApprovalPayload = {
          type: "tool-approval",
          toolCallId: call.id,
          toolName: call.name,
          input: call.input,
        };

        if (!options.requireApproval) {
          throw new ToolApprovalRequiredError(approvalPayload);
        }

        // Suspend until the approval gate resolves.
        const approved = await options.requireApproval(approvalPayload);

        if (!approved) {
          // Denial: inform the LLM the tool was refused, do not execute.
          messages.push({
            role: "tool",
            content: "Tool execution was denied by the user.",
            toolCallId: call.id,
          });
          toolResults.push({ denied: true, toolCallId: call.id });
          continue;
        }
      }

      // Execute the tool.
      try {
        const result = await impl.execute(
          call.input as z.infer<typeof impl.parameters>,
        );
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

    // Feed tool results back: one step = one tool-execution cycle
    // (initial call → tools execute → feed call). stopWhen fires AFTER the
    // feed call so it sees both toolResults and the LLM's reaction text.
    const feedResponse = await provider.generate({
      model,
      messages,
      tools: toolDefs.length > 0 ? toolDefs : undefined,
    });
    totalTokens += feedResponse.usage?.totalTokens ?? 0;

    const currentStep: StepInfo = {
      stepNumber,
      messages: [...messages],
      toolResults,
      lastResponse: feedResponse.text || undefined,
    };
    steps.push(currentStep);

    // Check custom stop condition AFTER the feed call.
    if (options.stopWhen?.(currentStep)) {
      break;
    }

    // If feed response has no further tool calls the conversation is complete.
    if ((feedResponse.toolCalls ?? []).length === 0) {
      messages.push({ role: "assistant", content: feedResponse.text });
      break;
    }

    // Feed response itself requests more tool calls; record the assistant turn
    // so the next step iteration sees a coherent message history.
    messages.push({ role: "assistant", content: feedResponse.text || "" });
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
