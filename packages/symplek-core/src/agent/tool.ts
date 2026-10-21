/**
 * @module agent/tool - Tool definition primitives for agent loops.
 * @description Defines the Tool interface, tool() factory, and the
 *   ToolApprovalPayload type used by the HITL approval gate in executeLoop().
 * @since 1.0.0-beta.1 — CR-402: requiresApproval + ToolApprovalPayload added
 */
import type { z } from "zod";

/**
 * Tool definition for agents.
 *
 * @typeParam P - Zod schema type for the tool's parameters
 * @typeParam R - Return type of the tool's execute function
 *
 * @remarks
 * When used with AgentUnit.loop(), name is required. Provide it via the
 * tool() factory so the executor can correlate provider responses to
 * implementations.
 *
 * requiresApproval gates execution through the loop's approval callback
 * (LoopOperatorOptions.requireApproval). When approval is absent and a
 * tool requires it, executeLoop throws ToolApprovalRequiredError.
 */
export interface Tool<P extends z.ZodType = any, R = any> {
  /**
   * Unique name for this tool. Required when using AgentUnit.loop() so the
   * executor can match provider tool_call responses to implementations.
   * Optional when using the legacy createAgent Record<string, Tool> API
   * (the record key provides the name).
   */
  name?: string;
  /** Description of what the tool does, used by the LLM to decide when to call it. */
  description: string;
  /** Zod schema for the tool's parameters. */
  parameters: P;
  /** The implementation of the tool. Called only after approval when requiresApproval is set. */
  execute: (params: z.infer<P>) => Promise<R>;
  /**
   * When true (or when predicate returns true for the given params), the tool
   * loop pauses before execution and routes through the requireApproval callback
   * in LoopOperatorOptions. A denied call is NOT executed; a denied tool result
   * message is inserted so the LLM knows the action was refused.
   */
  requiresApproval?: boolean | ((params: z.infer<P>) => boolean);
}

/**
 * Helper to define a tool with full type inference.
 *
 * Using `T extends Tool<P, R>` preserves the exact argument type (including
 * whether `name` is present as a required string). When the caller supplies
 * `name: "search"`, the return type carries `name: string` (required), making
 * the result directly assignable to `Array<Tool & { name: string }>` without
 * any type assertion. Without this, `tool()` would widen to `Tool<P,R>` whose
 * `name` is optional, forcing every `.loop()` call site to cast.
 *
 * @example
 * ```typescript
 * const search = tool({
 *   name: "web_search",
 *   description: "Search the web for information",
 *   parameters: z.object({ query: z.string() }),
 *   execute: async ({ query }) => fetchResults(query),
 * });
 * // search.name is string (required) — pass directly to .loop({ tools: [search] })
 * ```
 */
export function tool<P extends z.ZodType, R, T extends Tool<P, R>>(
  config: T,
): T {
  return config;
}

/**
 * The payload carried in a pending approval state when a tool with
 * requiresApproval is encountered by the executor.
 *
 * @remarks
 * This is the conduct-compatible pending decision shape for tool gates.
 * The loop suspends and passes this to the requireApproval callback
 * (LoopOperatorOptions); the callback returns true (approve) or false (deny).
 */
export interface ToolApprovalPayload {
  /** Discriminant — allows callers to identify this as a tool approval request. */
  type: "tool-approval";
  /** Provider-generated call identifier (matches the tool_use block id). */
  toolCallId: string;
  /** Name of the tool the model requested. */
  toolName: string;
  /** The deserialized tool input as returned by the provider. */
  input: unknown;
}
