/**
 * @module honesty.test — Surface-honesty assertions for @symplek/harness (Move 15 / B8 / A17 / N70)
 * @description Every assertion here represents a contract that was previously broken.
 *   A failure in this file means the fix regressed, not that the test is wrong.
 *
 *   Tests are grouped by the finding they gate:
 *   - B8  / Item 1: execute() must not stamp source:"verified" on a stub run.
 *   - A17 / Item 2: plan() stub must not stamp source:"tool" for unexecuted calls.
 *   - N70 / Item 3: result.value is the PlanArtifact — no double-wrap.
 *
 * @rules @.cursor/rules/patterns/029-file-header-contracts.mdc
 */

import { describe, expect, it } from "vitest";
import { createContext } from "@symplek/core";
import { createHarness } from "../adapter/claude-agent-sdk";
import { execute } from "../operators/execute";
import type { SdkSession } from "../operators/execute";
import { makePlanUnit } from "../operators/plan";
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

  it("requireMinChainConfidence gate result shape is also single-wrap", async () => {
    const unit = makePlanUnit("gate test", { tools: ["WebFetch"] }, config);
    const gated = unit.requireMinChainConfidence(0.5); // below 0.85 → passes
    const result = await gated.run(ctx);

    // gated result is also TrackedResult<PlanArtifact>, not double-wrapped
    expect(typeof result.value.id).toBe("string");
    expect(result.value.intent).toBe("gate test");
  });
});
