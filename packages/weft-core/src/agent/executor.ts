import { WeftError } from "../errors";
import { DEFAULT_LOOP_OPTIONS, type LoopOptions, type StepInfo } from "../loop";
import {
  type AIMessage,
  detectProvider,
  providerRegistry,
  selectModelForTask,
} from "../providers";
import type { Tool } from "./tool";

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

  // Map tools to provider format if supported
  const _providerTools = config.tools
    ? Object.entries(config.tools).map(([name, tool]) => ({
        type: "function" as const,
        function: {
          name,
          description: tool.description,
          parameters: (tool.parameters as any)._def
            ? (tool.parameters as any)
            : undefined, // Simplification for now
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
