/**
 * @module OpenAIAgentsAdapter - createOpenAIHarness factory wired to the OpenAI Agents SDK
 * @description Implements the Harness interface using the OpenAI Agents SDK as execution
 * backend. Mirrors the ClaudeAgentSDKAdapter contract exactly — same Harness interface,
 * same permission bridge (applied inside operators/execute.ts), same rehearsal trace format.
 * @openai/agents is an optional peer dep; when not installed, plan() works fully via the
 * stub path inherited from operators/plan.ts, and execute()/session() return no-op stub
 * responses instead of throwing, preserving the TrackedResult contract.
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

// ─── OpenAI Agents SDK interface stub ─────────────────────────────────────────
// @openai/agents is NOT a direct dependency. Declared locally so this file compiles
// whether or not the package is installed as a peer dep.
// Satisfies both SdkSession shapes used by execute.ts and session.ts (the execute.ts
// version is the superset — it adds optional canUseTool — so a single stub covers both).

interface OpenAIAgentSession {
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

// ─── Stub session ──────────────────────────────────────────────────────────────
// Used when @openai/agents is not installed. Mirrors the stub path in operators/plan.ts:
// returns a deterministic no-op finalMessage rather than throwing, so the harness
// remains constructable and the TrackedResult contract is preserved.

function buildStubSession(label?: string): OpenAIAgentSession {
  return {
    async run(_options): Promise<{ finalMessage: string }> {
      return {
        finalMessage: `[openai-agents stub] SDK not installed — ${label ?? "no-op"}`,
      };
    },
  };
}

// ─── SDK session factory (optional peer dep) ──────────────────────────────────
// Returns null when @openai/agents is not installed. Mirrors tryLoadSession() in
// operators/plan.ts — same dynamic-import pattern, different SDK target.

async function tryLoadOpenAISession(
  config: HarnessConfig,
  prompt?: string,
): Promise<OpenAIAgentSession | null> {
  // TODO(W2-D-wiring): instantiate from @openai/agents once installed as a peer dep.
  // Example:
  //   const { Agent, run } = await import("@openai/agents");
  //   const agent = new Agent({
  //     name: "@symplek/harness",
  //     model: config.model ?? "gpt-4o",
  //     instructions: prompt,
  //   });
  //   return {
  //     run: (opts) => run(agent, prompt ?? "", {
  //       guardrails: opts.canUseTool ? [buildPermissionGuardrail(opts.canUseTool)] : [],
  //       onEvent: opts.onEvent,
  //     }),
  //   };
  void config;
  void prompt;
  return null;
}

// ─── Factory ──────────────────────────────────────────────────────────────────

/**
 * Create a Harness instance backed by the OpenAI Agents SDK.
 *
 * Drop-in replacement for the Claude adapter — swap `adapter: "claude-agent-sdk"` for
 * `adapter: "openai-agents"` in the `createHarness()` config and the plan/execute/session
 * chain behaves identically: same permission bridge, same TrackedResult shape, same
 * rehearsal trace format.
 *
 * @example
 * ```typescript
 * const harness = createOpenAIHarness({ adapter: "openai-agents", tools: ["Read", "Grep"] });
 * const unit = harness.plan("migrate auth to PKCE", { tools: ["Read", "Grep"] });
 * const result = await unit.run(ctx);
 * // result is TrackedResult<PlanArtifact> — single wrap, result.value.id is the plan ID.
 * console.log(result.value.id); // SHA-256 plan ID — identical to Claude adapter output
 * ```
 */
export function createOpenAIHarness(config: HarnessConfig): Harness {
  return {
    plan(intent: string, options?: PlanOptions) {
      // makePlanUnit manages SDK sessions internally via its own tryLoadSession().
      // The OpenAI adapter passes config through so model and tool declarations
      // are respected when @openai/agents is eventually installed.
      return makePlanUnit(intent, options, config);
    },

    execute<T>(verified: VerifiedPlan<T>, options?: ExecuteOptions) {
      // The permission bridge is constructed inside executeOperator from the verified plan.
      // This adapter provides the SdkSession; executeOperator applies the bridge to it.
      //
      // isStub:true because tryLoadOpenAISession currently always returns null — the
      // session always falls through to buildStubSession. Set isStub:false here once
      // tryLoadOpenAISession is wired to a real @openai/agents session (W2-D).
      const sdkSession: OpenAIAgentSession = {
        async run(runOptions) {
          const real = await tryLoadOpenAISession(config);
          const effective =
            real ?? buildStubSession(`execute:${verified.plan.id}`);
          return effective.run(runOptions);
        },
      };
      return executeOperator(sdkSession, verified, options, { isStub: true });
    },

    session(prompt: string) {
      const sdkSession: OpenAIAgentSession = {
        async run(runOptions) {
          const real = await tryLoadOpenAISession(config, prompt);
          const effective =
            real ?? buildStubSession(`session:${prompt.slice(0, 40)}`);
          return effective.run(runOptions);
        },
      };
      // openai-agents is always a stub (not wired) — source must be "synthesized".
      return sessionOperator(sdkSession, prompt, { isStub: true });
    },
  };
}
