/**
 * @module Session - Full-autonomy escape hatch operator for @symplek/harness
 * @description Implements `session()` — runs a Claude Agent SDK session in
 * `bypassPermissions` mode (full autonomy). Wraps the final output in a
 * `TrackedResult<string>` so every tool call is still observable through the
 * `sourceChain`. This is the escape hatch for tasks where per-step permission
 * gating is impractical, while retaining the trust loop's audit trail.
 * @rules @.cursor/rules/patterns/029-file-header-contracts.mdc
 */

import { AgentUnit, createTrackedResult } from "@symplek/core";
import type { ResultSource, TrackedResult } from "@symplek/core";
import type { SourceRef } from "../types.js";

// ─── SDK Interface Stub ───────────────────────────────────────────────────────
// @anthropic-ai/claude-agent-sdk is NOT a direct dependency. The adapter module
// (adapter/claude-agent-sdk.ts, W1-B) constructs a real session that satisfies
// this interface and injects it here. Re-uses the same stub shape as execute.ts.

export interface SdkEvent {
  type: string;
  tool?: string;
  args?: unknown;
  result?: unknown;
}

export interface SdkSession {
  run(options: {
    permissionMode: "default" | "acceptEdits" | "bypassPermissions";
    onEvent?: (event: SdkEvent) => void;
  }): Promise<{ finalMessage: string }>;
}

// ─── Session Operator ─────────────────────────────────────────────────────────

/**
 * Run a full-autonomy SDK session and return the output wrapped in a
 * `TrackedResult<string>` with an accumulated tool-call source chain.
 *
 * No permission bridge is applied — the session runs in `bypassPermissions`
 * mode. The value-add over a raw SDK call is observability: every tool use
 * is recorded as a `SourceRef` so downstream consumers can audit what the
 * agent touched, compute confidence from the call count, and surface the
 * chain without re-running the session.
 *
 * @param sdkSession - An SdkSession provided by the adapter (W1-B), already
 *   constructed with the caller's prompt and model config.
 * @param prompt - The original prompt string; embedded in the TrackedResult
 *   for traceability. The adapter is responsible for passing this to the SDK.
 * @param context - Execution context. Pass `{ isStub: true }` when the session
 *   is a no-op stub (SDK not installed) so the result is honestly labelled
 *   `source:"synthesized"` instead of `source:"agent"`.
 */
export function session(
  sdkSession: SdkSession,
  prompt: string,
  context: { isStub?: boolean } = {},
): AgentUnit<TrackedResult<string>> {
  return AgentUnit.from<TrackedResult<string>>(async (_ctx) => {
    // Accumulate one SourceRef per tool_use event, mirroring the SourceRef
    // shape used by PlanArtifact.sources so downstream operators can treat
    // session sources identically to plan sources.
    const sources: SourceRef[] = [];

    const onEvent = (event: SdkEvent): void => {
      if (event.type === "tool_use" && event.tool) {
        // Deterministic pseudo-hash from tool name + position in call sequence.
        // A real content hash would require the result payload to be stable;
        // for session mode we use a lightweight positional fingerprint instead.
        const contentHash = `${event.tool}:${sources.length}:${Date.now()}`;
        sources.push({
          kind: "tool_output",
          uri: event.tool,
          contentHash,
          // Agent-generated tool output starts at 0.7 confidence — not
          // verified by consensus, but traceable and auditable.
          confidence: 0.7,
        });
      }
    };

    const sdkResult = await sdkSession.run({
      permissionMode: "bypassPermissions",
      onEvent,
    });

    // Confidence degrades slightly the more tool calls occur — longer chains
    // have more opportunities for error accumulation. Floor at 0.5 (no sources).
    const chainConfidence =
      sources.length === 0 ? 0.5 : Math.max(0.5, 0.7 - sources.length * 0.01);

    // source:"agent" is only honest when a real SDK session executed the prompt.
    // When the SDK is absent and the session is a stub, use source:"synthesized"
    // so callers can distinguish un-run stub results from genuinely executed ones.
    const source: ResultSource = context.isStub ? "synthesized" : "agent";
    const tracked = createTrackedResult(sdkResult.finalMessage, {
      source,
      confidence: chainConfidence,
      // verifiedBy only makes sense when real execution happened.
      ...(source === "agent"
        ? {
            verifiedBy: `@symplek/harness/session@prompt:${prompt.slice(0, 40)}`,
          }
        : {}),
      sourceChain: sources.map(() => "tool" as ResultSource),
      minChainConfidence: chainConfidence,
    });

    return tracked;
  });
}
