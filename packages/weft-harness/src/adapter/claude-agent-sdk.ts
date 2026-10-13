/**
 * @module ClaudeAgentSDKAdapter - createHarness factory wired to the Claude Agent SDK
 * @description Implements the Harness interface using the Claude Agent SDK as execution
 * backend. Routes to createOpenAIHarness when config.adapter is "openai-agents", making
 * createHarness the single adapter-agnostic entry point. W2-C wires execute() and
 * session() to their operator modules; when the optional peer SDK is absent, a no-op
 * SdkSession stub preserves the TrackedResult contract without throwing.
 * @rules @.cursor/rules/patterns/029-file-header-contracts.mdc
 */

import { execute as executeOperator } from "../operators/execute.js";
import { makePlanUnit } from "../operators/plan.js";
import { session as sessionOperator } from "../operators/session.js";
import type {
  ExecuteOptions,
  Harness,
  HarnessConfig,
  PlanOptions,
  VerifiedPlan,
} from "../types.js";
import { createOpenAIHarness } from "./openai-agents.js";

// ─── Claude Agent SDK interface stub ─────────────────────────────────────────
// @anthropic-ai/claude-agent-sdk is NOT a direct dependency. Declared locally
// so this file compiles whether or not the package is installed as a peer dep.
// Satisfies both SdkSession shapes used by execute.ts and session.ts (execute.ts
// is the superset — adds optional canUseTool — so a single stub covers both).

interface ClaudeAgentSession {
  run(options: {
    permissionMode: "default" | "acceptEdits" | "bypassPermissions";
    canUseTool?: (
      toolName: string,
      args: unknown,
    ) => { behavior: "allow" | "block" };
    onEvent?: (event: {
      type: string;
      tool?: string;
      args?: unknown;
      result?: unknown;
    }) => void;
  }): Promise<{ finalMessage: string }>;
}

// ─── Stub session ─────────────────────────────────────────────────────────────
// Used when @anthropic-ai/claude-agent-sdk is not installed. Returns an empty
// finalMessage so the trust loop (plan → verify → execute) remains runnable
// in a test or sandboxed environment without the real SDK installed.

function buildStubSession(label?: string): ClaudeAgentSession {
  return {
    async run(_options): Promise<{ finalMessage: string }> {
      return {
        finalMessage: `[claude-agent-sdk stub] SDK not installed — ${label ?? "no-op"}`,
      };
    },
  };
}

// ─── SDK session factory (optional peer dep) ─────────────────────────────────
// Returns null when @anthropic-ai/claude-agent-sdk is not installed. Same
// tryLoadSession pattern as the OpenAI adapter.

function tryLoadSession(
  _config: HarnessConfig,
  _prompt?: string,
): ClaudeAgentSession | null {
  // TODO(W2-D-wiring): instantiate from @anthropic-ai/claude-agent-sdk once
  // installed as a peer dep. Example:
  //   const { AnthropicAgent } = require("@anthropic-ai/claude-agent-sdk");
  //   const agent = new AnthropicAgent({ model: config.model, systemPrompt: prompt });
  //   return { run: (opts) => agent.run({ ...opts }) };
  return null;
}

// ─── Factory ──────────────────────────────────────────────────────────────────

/**
 * Create a Harness instance, routing to the correct adapter based on `config.adapter`.
 *
 * @example
 * ```typescript
 * // Claude Agent SDK backend
 * const harness = createHarness({ adapter: "claude-agent-sdk", tools: ["Read", "Grep"] });
 *
 * // OpenAI Agents SDK backend — identical chain, different execution backend
 * const harness = createHarness({ adapter: "openai-agents", tools: ["Read", "Grep"] });
 *
 * const unit = harness.plan("migrate auth to PKCE", { tools: ["Read", "Grep"] });
 * const result = await unit.run(ctx);
 * // result is TrackedResult<PlanArtifact> — a single wrap, not double-wrapped.
 * console.log(result.value.id); // SHA-256 plan ID — same shape for both adapters
 * ```
 */
export function createHarness(config: HarnessConfig): Harness {
  if (config.adapter === "openai-agents") {
    return createOpenAIHarness(config);
  }

  return {
    plan(intent: string, options?: PlanOptions) {
      return makePlanUnit(intent, options, config);
    },

    execute<T>(verified: VerifiedPlan<T>, options?: ExecuteOptions) {
      // isStub:true when SDK is absent so execute() stamps source:"synthesized"
      // not source:"verified" — un-run stub results must not claim verification.
      // Set isStub:false once tryLoadSession returns a real session (W2-D wiring).
      const realSession = tryLoadSession(config, verified.plan.intent);
      const sdkSession = realSession ?? buildStubSession(`execute:${verified.plan.id}`);
      return executeOperator(sdkSession, verified, options, { isStub: !realSession });
    },

    session(prompt: string) {
      const realSession = tryLoadSession(config, prompt);
      const sdkSession = realSession ?? buildStubSession(`session:${prompt.slice(0, 40)}`);
      return sessionOperator(sdkSession, prompt, { isStub: !realSession });
    },
  };
}
