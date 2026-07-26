/**
 * @module AgentUnit/operators/loop
 * @description AgentUnit.loop() operator — drives a multi-turn LLM↔tool cycle.
 *   Surfaces the tool loop through the AgentUnit composition API and routes
 *   requiresApproval tools through an async approval gate (the conduct-pattern
 *   analog for tool-call HITL).
 * @since 1.0.0-beta.1 — CR-402
 * @blast_radius MEDIUM — new surface; doesn't modify existing operators
 * @runtime node
 * @surface public (via weft-core/agent subpath)
 */

import type { AgentComputation } from "../AgentUnit";
import { AgentUnit } from "../AgentUnit";
import type { AgentResult, LoopExecuteOptions } from "../../agent/executor";
import { executeLoop } from "../../agent/executor";
import type { Tool, ToolApprovalPayload } from "../../agent/tool";
import type { LoopOptions } from "../../loop";
import type { Provider } from "../../providers/interface";
import { detectProvider, providerRegistry } from "../../providers";

// ─── PUBLIC TYPES ──────────────────────────────────────────────────────────────

/**
 * Options for AgentUnit.loop(). Combines LoopOptions (stop conditions, step
 * count) with tool definitions and the HITL approval gate.
 *
 * @example No approval required
 * ```typescript
 * const result = await AgentUnit.of("What is 2 + 2?")
 *   .loop({ tools: [calculatorTool], model: "claude-opus-4-5" })
 *   .run(ctx);
 * ```
 *
 * @example With approval gate
 * ```typescript
 * const result = await AgentUnit.of("Search for Weft docs")
 *   .loop({
 *     tools: [searchTool],
 *     requireApproval: async (payload) => promptUser(payload),
 *   })
 *   .run(ctx);
 * ```
 */
export interface LoopOperatorOptions extends LoopOptions {
  /**
   * Tools the model may call during the loop. Each tool must have a `name`
   * field so the executor can correlate provider tool_call responses to
   * implementations.
   */
  tools?: Array<Tool & { name: string }>;
  /**
   * Explicit AI provider. When omitted, the executor resolves the active
   * provider from the registry (same as executeAgent). Inject a provider in
   * tests to avoid real API calls.
   */
  provider?: Provider;
  /**
   * Model identifier forwarded to provider.generate(). Defaults to
   * "claude-opus-4-5" when absent.
   */
  model?: string;
  /**
   * Approval gate for requiresApproval tools. The loop suspends at each
   * approval-gated tool call and awaits this callback:
   *   - Returns true  → tool is executed normally.
   *   - Returns false → tool is skipped; LLM receives a denial message.
   *
   * When absent and a tool with requiresApproval is encountered, the loop
   * throws ToolApprovalRequiredError (configuration error, not a runtime denial).
   */
  requireApproval?: (payload: ToolApprovalPayload) => Promise<boolean>;
}

// ─── PROTOTYPE AUGMENTATION ────────────────────────────────────────────────────

AgentUnit.prototype.loop = function <T>(
  this: AgentUnit<T>,
  options: LoopOperatorOptions = {},
): AgentUnit<AgentResult> {
  const selfComp = (this as unknown as { computation: AgentComputation<T> })
    .computation;
  const selfMeta = this.getMetadata();

  return AgentUnit._make<AgentResult>(
    async (ctx) => {
      // Resolve the initial value (typically a string prompt).
      const initialValue = await selfComp(ctx);
      const prompt = String(initialValue);

      // Resolve provider: explicit injection > registry lookup.
      let provider = options.provider;
      if (!provider) {
        const providerId = detectProvider();
        provider = providerRegistry.get(providerId);
        if (!provider) {
          throw new Error(
            `No AI provider available. Register a provider or pass provider in loop options.`,
          );
        }
      }

      const tools = options.tools ?? [];
      const loopOptions: LoopExecuteOptions = {
        maxSteps: options.maxSteps,
        stopWhen: options.stopWhen,
        prepareStep: options.prepareStep,
        model: options.model,
        requireApproval: options.requireApproval,
      };

      return executeLoop(
        provider,
        [{ role: "user", content: prompt }],
        tools,
        loopOptions,
      );
    },
    {
      ...selfMeta,
      id: AgentUnit._generateId(),
      operatorChain: [...selfMeta.operatorChain, "loop"],
      createdAt: Date.now(),
    },
  );
};
