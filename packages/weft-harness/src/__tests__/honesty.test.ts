/**
 * @module honesty.test — Surface-honesty assertions for weft-harness (Move 15 / B8 / A17 / N70 / S-SESSION)
 * @description Every assertion here represents a contract that was previously broken.
 *   A failure in this file means the fix regressed, not that the test is wrong.
 *
 *   Tests are grouped by the finding they gate:
 *   - B8         / Item 1: execute() must not stamp source:"verified" on a stub run.
 *   - A17        / Item 2: plan() stub must not stamp source:"tool" for unexecuted calls.
 *   - N70        / Item 3: result.value is the PlanArtifact — no double-wrap.
 *   - S-SESSION  / Item 4: session() stub must not stamp source:"agent" or verifiedBy.
 *
 * @rules @.cursor/rules/patterns/029-file-header-contracts.mdc
 */

import { describe, expect, it } from "vitest";
import { createContext } from "weft-core";
import { createHarness } from "../adapter/claude-agent-sdk";
import { execute } from "../operators/execute";
import type { SdkSession } from "../operators/execute";
import { makePlanUnit } from "../operators/plan";
import { session } from "../operators/session";
import type { HarnessConfig, VerifiedPlan } from "../types";

const ctx = createContext();
const config: HarnessConfig = { adapter: "claude-agent-sdk" };

// ─── Minimal SdkSession stub for execute() tests ──────────────────────────────

function makeStubSession(finalMessage = "stub output"): SdkSession {
  return {
    async run(_options) {
      return { finalMessage };
    },
  };
}

function makeVerifiedPlan(): VerifiedPlan<unknown> {
  return {
    plan: {
      id: "honesty-test-plan",
      intent: "honesty test",
      steps: [],
      requiredTools: [],
      estimatedImpact: "P3",
      sources: [],
    },
    votes: [],
    approvalScore: 0.9,
  };
}

// ─── B8: execute() stub must not claim source:"verified" ─────────────────────

describe("B8 — execute() stub provenance is honest", () => {
  it("stub execute() stamps source:'synthesized', not source:'verified'", async () => {
    const session = makeStubSession();
    const verified = makeVerifiedPlan();

    // isStub:true → should produce source:"synthesized"
    const unit = execute(session, verified, {}, { isStub: true });
    const result = await unit.run(ctx, { trustMode: "legacy" });

    expect(result.source).toBe("synthesized");
    expect(result.source).not.toBe("verified");
  });

  it("non-stub execute() stamps source:'verified'", async () => {
    const session = makeStubSession("real output");
    const verified = makeVerifiedPlan();

    // isStub:false (SDK present) → should produce source:"verified"
    const unit = execute(session, verified, {}, { isStub: false });
    const result = await unit.run(ctx, { trustMode: "legacy" });

    expect(result.source).toBe("verified");
    expect((result as any).verifiedAt).toBeDefined();
    expect((result as any).verifiedBy).toContain("honesty-test-plan");
  });

  it("createHarness execute() returns source:'synthesized' (SDK stub always active)", async () => {
    const harness = createHarness({ adapter: "claude-agent-sdk", tools: ["Read"] });
    const verified = makeVerifiedPlan();

    const unit = harness.execute(verified);
    const result = await unit.run(ctx, { trustMode: "legacy" });

    // The SDK is not wired — every execute() is a stub run — must NOT be "verified".
    expect(result.source).toBe("synthesized");
  });
});

// ─── A17: plan() stub must not claim source:"tool" ───────────────────────────

describe("A17 — plan() stub provenance is honest", () => {
  it("stub plan() sets synthesized:true on PlanArtifact", async () => {
    const unit = makePlanUnit("test intent", { tools: ["Read"] }, config);
    const result = await unit.run(ctx);

    // result.value is PlanArtifact (single wrap after N70 fix)
    expect(result.value.synthesized).toBe(true);
  });

  it("stub plan sources carry heuristic confidences, not fabricated execution records", async () => {
    const unit = makePlanUnit("test intent", { tools: ["WebFetch"] }, config);
    const result = await unit.run(ctx);
    const artifact = result.value;

    // synthesized flag is set
    expect(artifact.synthesized).toBe(true);
    // sources still carry heuristic confidence values (tool-type metadata, not exec records)
    expect(artifact.sources[0].confidence).toBe(0.85);
  });
});

// ─── N70: result.value is PlanArtifact — single wrap ─────────────────────────

describe("N70 — plan() result shape: single wrap, result.value.id is the plan ID", () => {
  it("result.value is the PlanArtifact (id, intent, steps accessible directly)", async () => {
    const unit = makePlanUnit("shape test intent", { tools: ["Read"] }, config);
    const result = await unit.run(ctx);

    // result.value must be PlanArtifact, not TrackedResult<PlanArtifact>
    const artifact = result.value;
    expect(typeof artifact.id).toBe("string");
    expect(artifact.id).toHaveLength(64); // SHA-256 hex
    expect(artifact.intent).toBe("shape test intent");
    expect(Array.isArray(artifact.steps)).toBe(true);
    expect(Array.isArray(artifact.sources)).toBe(true);
  });

  it("result.value.id matches the documented API shape (not result.value.value.id)", async () => {
    const harness = createHarness({ adapter: "claude-agent-sdk", tools: ["Read"] });
    const unit = harness.plan("migrate auth to PKCE", { tools: ["Read"] });
    const result = await unit.run(ctx);

    // The doc contract: result.value.id is the SHA-256 plan ID.
    // Before N70 fix this was result.value.value.id (double-wrap). This test
    // would fail if the double-wrap regresses.
    expect(typeof result.value.id).toBe("string");
    expect(result.value.id.length).toBeGreaterThan(0);
    expect(result.value.intent).toBe("migrate auth to PKCE");
  });

  it("requireMinChainConfidence gate throws for synthesized plans (H9 correction)", async () => {
    // CORRECTED (H9): requireMinChainConfidence now rejects synthesized plans
    // unconditionally because their sources are heuristic estimates, not real
    // execution records. The old test used a stub plan which is always synthesized.
    const unit = makePlanUnit("gate test", { tools: ["WebFetch"] }, config);
    const gated = unit.requireMinChainConfidence(0.5);

    // A synthesized plan always throws LowProvenanceError.
    const { LowProvenanceError: LPE } = await import("../errors");
    await expect(gated.run(ctx)).rejects.toBeInstanceOf(LPE);
  });
});

// ─── H3: default (zero-trust) mode — inner value carries honest label ─────────
// In zero-trust mode AgentUnit.run() wraps the operator's return value in a second
// TrackedResult. The outer source is stamped by the framework; what matters for
// honesty is (a) the outer source is never "verified" on a stub, and (b) the inner
// value's source is "synthesized" so callers who inspect it see the truth.

describe("H3 — default (zero-trust) mode exposes honest source in result.value", () => {
  it("execute() stub — outer source is 'agent' (framework wrapper) in default mode", async () => {
    // In zero-trust mode the framework wraps the operator result in a second
    // TrackedResult stamped source:"agent" by AgentUnit (see zeroTrust.ts).
    // Verify the exact label, not just 'not verified'.
    const sdkSession = makeStubSession();
    const verified = makeVerifiedPlan();

    const unit = execute(sdkSession, verified, {}, { isStub: true });
    const result = await unit.run(ctx); // no trustMode — zero-trust default

    expect(result.source).toBe("agent");
  });

  it("execute() stub — inner result.value.source is 'synthesized' in default mode", async () => {
    const sdkSession = makeStubSession();
    const verified = makeVerifiedPlan();

    const unit = execute(sdkSession, verified, {}, { isStub: true });
    const result = await unit.run(ctx); // no trustMode

    // result.value is the TrackedResult<T> from the operator (double-wrap in zero-trust)
    const inner = result.value as { source?: string };
    expect(inner.source).toBe("synthesized");
  });

  it("session() stub — outer source is 'agent' (framework wrapper) in default mode", async () => {
    const stubSession = makeStubSession();
    const unit = session(stubSession, "test prompt", { isStub: true });
    const result = await unit.run(ctx); // no trustMode

    expect(result.source).toBe("agent");
  });

  it("session() stub — inner result.value.source is 'synthesized' in default mode", async () => {
    const stubSession = makeStubSession();
    const unit = session(stubSession, "test prompt", { isStub: true });
    const result = await unit.run(ctx); // no trustMode

    const inner = result.value as { source?: string };
    expect(inner.source).toBe("synthesized");
  });
});

// ─── H4: execute() with no context argument defaults to isStub:true ───────────
// Before this fix: context defaulted to {} → isStub=undefined → falsy → source:"verified"
// on any session including ReplayAdapter. Now defaults to isStub:true.

describe("H4 — execute() with no context argument defaults to synthesized, not verified", () => {
  it("calling execute(session, plan) with no context does not stamp source:'verified'", async () => {
    const sdkSession = makeStubSession();
    const verified = makeVerifiedPlan();

    // Three-argument form — no context provided
    const unit = execute(sdkSession, verified);
    const result = await unit.run(ctx, { trustMode: "legacy" });

    expect(result.source).not.toBe("verified");
    expect(result.source).toBe("synthesized");
  });

  it("ReplayAdapter passed to execute() without context yields source:'synthesized'", async () => {
    // ReplayAdapter satisfies SdkSession. Without context, isStub should default to true.
    const replayLike: SdkSession = {
      async run(_options) {
        return { finalMessage: "replayed output" };
      },
    };
    const verified = makeVerifiedPlan();

    const unit = execute(replayLike, verified); // no context
    const result = await unit.run(ctx, { trustMode: "legacy" });

    expect(result.source).not.toBe("verified");
    expect(result.source).toBe("synthesized");
  });
});

// ─── S-SESSION: session() stub must not claim source:"agent" ─────────────────
// Before this fix: session() always stamped source:"agent" + verifiedBy regardless
// of whether the SDK was installed. A stub session must say source:"synthesized".

describe("S-SESSION — session() stub provenance is honest", () => {
  function makeSessionStub(finalMessage = "stub output"): SdkSession {
    return {
      async run(_options) {
        return { finalMessage };
      },
    };
  }

  it("stub session() stamps source:'synthesized', not source:'agent'", async () => {
    const stubSession = makeSessionStub();
    const unit = session(stubSession, "test prompt", { isStub: true });
    const result = await unit.run(ctx, { trustMode: "legacy" });

    expect(result.source).toBe("synthesized");
    expect(result.source).not.toBe("agent");
  });

  it("stub session() does not set verifiedBy", async () => {
    const stubSession = makeSessionStub();
    const unit = session(stubSession, "test prompt", { isStub: true });
    const result = await unit.run(ctx, { trustMode: "legacy" });

    expect((result as Record<string, unknown>).verifiedBy).toBeUndefined();
  });

  it("real session() stamps source:'agent' and sets verifiedBy", async () => {
    const realSession = makeSessionStub("real output");
    const unit = session(realSession, "test prompt", { isStub: false });
    const result = await unit.run(ctx, { trustMode: "legacy" });

    expect(result.source).toBe("agent");
    expect((result as Record<string, unknown>).verifiedBy).toBeDefined();
  });

  it("createHarness.session() returns source:'synthesized' when SDK is absent", async () => {
    const harness = createHarness({ adapter: "claude-agent-sdk", tools: ["Read"] });
    const unit = harness.session("test prompt");
    const result = await unit.run(ctx, { trustMode: "legacy" });

    // The SDK is never wired — session() must not claim source:"agent".
    expect(result.source).toBe("synthesized");
  });

  it("session() called with no context argument defaults to 'synthesized', not 'agent'", async () => {
    // A session nobody labelled is a stand-in. Reading a missing isStub as
    // "not a stub" used to stamp this result "agent".
    const stubSession = makeSessionStub();
    const unit = session(stubSession, "test prompt"); // no third argument
    const result = await unit.run(ctx, { trustMode: "legacy" });

    expect(result.source).toBe("synthesized");
    expect(result.source).not.toBe("agent");
  });
});
