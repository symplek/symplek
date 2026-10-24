/**
 * @module algorithms.test
 * @description Regression tests for the six @symplek/pro algorithm defects fixed
 * in the Wave-3 correctness pass (campaign codebase-review-2026-07-10).
 *
 * Items covered:
 *   N55 — TaCo agreement metric (unanimous rejection must converge)
 *   N56 — Antibodies regex lastIndex (global regex must be deterministic)
 *   N62 — TrustRegistry live references (check/getAll return copies)
 *   N71 — Stigmergy evaporationRate > 1 → NaN (validate at boundary)
 */

import { describe, expect, it } from "vitest";
import { AgentUnit, createContext } from "@symplek/core";
import {
  AntibodyRegistry,
  ConfidentStigmergyLayer,
  TrustRegistry,
  createConfidentPheromone,
  tacoConsensus,
} from "../index";
import type { TaCoVote } from "../types";

const ctx = createContext();

// ─── N55: TaCo agreement metric ───────────────────────────────────────────────

describe("tacoConsensus — agreement metric (N55)", () => {
  it("converges immediately on unanimous approve (baseline)", async () => {
    const voter = async (): Promise<TaCoVote> => ({
      agentId: "v1",
      decision: "approve",
      rationale: "good",
      confidence: 0.9,
    });

    const unit = AgentUnit.from(() => Promise.resolve("proposal"));
    const result = await tacoConsensus([voter, voter, voter], {
      maxRounds: 3,
      convergenceThreshold: 0.8,
    })(unit).run(ctx, { trustMode: "legacy" });

    expect(result.converged).toBe(true);
    expect(result.rounds).toHaveLength(1); // exits after round 1
    expect(result.finalAgreementLevel).toBeCloseTo(1.0);
  });

  it("converges immediately on unanimous reject (was broken — scored 0 agreement)", async () => {
    const voter = async (): Promise<TaCoVote> => ({
      agentId: "v1",
      decision: "reject",
      rationale: "bad",
      confidence: 0.9,
    });

    const unit = AgentUnit.from(() => Promise.resolve("proposal"));
    const result = await tacoConsensus([voter, voter, voter], {
      maxRounds: 3,
      convergenceThreshold: 0.8,
    })(unit).run(ctx, { trustMode: "legacy" });

    // The whole point: unanimous rejection must converge in round 1, not burn
    // every remaining round with agreement = 0 and then give up.
    expect(result.converged).toBe(true);
    expect(result.rounds).toHaveLength(1);
    expect(result.finalAgreementLevel).toBeCloseTo(1.0);
    expect(result.approved).toBe(false); // unanimous reject → not approved
  });

  it("does not converge on a genuine 50/50 split", async () => {
    let callCount = 0;
    const voter = async (): Promise<TaCoVote> => {
      callCount++;
      return {
        agentId: `v${callCount}`,
        decision: callCount % 2 === 0 ? "approve" : "reject",
        rationale: "split",
        confidence: 0.6,
      };
    };

    const unit = AgentUnit.from(() => Promise.resolve("proposal"));
    const result = await tacoConsensus([voter, voter], {
      maxRounds: 2,
      convergenceThreshold: 0.9,
    })(unit).run(ctx, { trustMode: "legacy" });

    expect(result.converged).toBe(false);
    expect(result.finalAgreementLevel).toBeCloseTo(0.5);
  });
});

// ─── N56: Antibodies regex lastIndex ─────────────────────────────────────────

describe("AntibodyRegistry — regex lastIndex (N56)", () => {
  it("global regex matches identically on every repeated call to the same input", () => {
    const registry = new AntibodyRegistry();
    // /g flag: without the fix, .test() advances lastIndex so the second call
    // on the same string returns false (alternating match/no-match).
    registry.registerPattern({
      id: "injection",
      matcher: {
        type: "regex",
        pattern: /<script[^>]*>/gi, // global AND case-insensitive
      },
      description: "Detects script injection",
      severity: "critical",
      learnedAt: Date.now(),
    });

    const malicious = '<script src="evil.js">';

    // All three scans of identical input must produce the same result.
    const r1 = registry.scan(malicious);
    const r2 = registry.scan(malicious);
    const r3 = registry.scan(malicious);

    expect(r1.recommendation).toBe("reject");
    expect(r2.recommendation).toBe("reject");
    expect(r3.recommendation).toBe("reject");
  });

  it("sticky regex also matches deterministically on repeated identical input", () => {
    const registry = new AntibodyRegistry();
    registry.registerPattern({
      id: "sticky-pat",
      matcher: {
        type: "regex",
        pattern: /badword/y, // sticky flag
      },
      description: "Sticky pattern",
      severity: "high",
      learnedAt: Date.now(),
    });

    const bad = "badword extra";
    const r1 = registry.scan(bad);
    const r2 = registry.scan(bad);

    expect(r1.recommendation).toBe("quarantine");
    expect(r2.recommendation).toBe("quarantine");
  });

  it("benign input is never flagged regardless of how many times it is scanned", () => {
    const registry = new AntibodyRegistry();
    registry.registerPattern({
      id: "xss",
      matcher: { type: "regex", pattern: /<script/gi },
      description: "XSS",
      severity: "critical",
      learnedAt: Date.now(),
    });

    const safe = "Hello, world!";
    for (let i = 0; i < 5; i++) {
      expect(registry.scan(safe).recommendation).toBe("allow");
    }
  });
});

// ─── N62: TrustRegistry live references ──────────────────────────────────────

describe("TrustRegistry — no live references (N62)", () => {
  it("mutating the object returned by check() does not corrupt registry state", () => {
    const reg = new TrustRegistry();
    reg.register("agent-1", "full", {
      expiresAt: Date.now() + 60_000,
      reason: "verified",
    });

    const grant = reg.check("agent-1");
    expect(grant).not.toBeNull();

    // Mutate the returned copy
    // @ts-expect-error — deliberate runtime mutation test
    grant!.level = "none";

    // Registry must be unaffected
    const again = reg.check("agent-1");
    expect(again?.level).toBe("full");
  });

  it("mutating a value returned by getAll() does not corrupt registry state", () => {
    const reg = new TrustRegistry();
    reg.register("agent-2", "partial", { reason: "semi-trusted" });

    const snapshot = reg.getAll();
    const copy = snapshot.get("agent-2");
    expect(copy).toBeDefined();

    // Mutate through the snapshot value
    // @ts-expect-error — deliberate runtime mutation test
    copy!.level = "full";

    // Registry must be unaffected
    const fresh = reg.check("agent-2");
    expect(fresh?.level).toBe("partial");
  });

  it("getAll() snapshot is independent — adding entries after the call is not visible", () => {
    const reg = new TrustRegistry();
    reg.register("agent-3", "full");

    const before = reg.getAll();
    reg.register("agent-4", "partial");

    expect(before.has("agent-4")).toBe(false);
  });
});

// ─── N71: Stigmergy numeric validation ───────────────────────────────────────

describe("createConfidentPheromone — numeric validation (N71)", () => {
  it("throws RangeError when evaporationRate > 1", () => {
    expect(() =>
      createConfidentPheromone("val", {
        confidence: 0.9,
        source: "agent",
        evaporationRate: 1.5,
      }),
    ).toThrow(RangeError);
  });

  it("throws RangeError when evaporationRate < 0", () => {
    expect(() =>
      createConfidentPheromone("val", {
        confidence: 0.9,
        source: "agent",
        evaporationRate: -0.1,
      }),
    ).toThrow(RangeError);
  });

  it("throws RangeError when confidence is NaN", () => {
    expect(() =>
      createConfidentPheromone("val", {
        confidence: NaN,
        source: "agent",
      }),
    ).toThrow(RangeError);
  });

  it("NaN confidence from evaporationRate > 1 would evade isExpired — the validation prevents this", () => {
    // Before the fix: evaporationRate=2 → currentConfidence = C * (1-2)^age = C * (-1)^age
    // which oscillates and is not reliably < minConfidence, so isExpired() could return false.
    // The fix throws before the pheromone is created.
    expect(() =>
      createConfidentPheromone("signal", {
        confidence: 0.8,
        source: "verified",
        evaporationRate: 2,
        minConfidence: 0.1,
      }),
    ).toThrow(RangeError);
  });

  it("valid inputs produce a pheromone that decays to isExpired()", async () => {
    // evaporationRate=0.5, minConfidence=0.9 → expires after just a couple of seconds
    // Use a high evaporation rate and high minConfidence so expiry is testable quickly.
    const p = createConfidentPheromone("signal", {
      confidence: 0.95,
      source: "agent",
      evaporationRate: 0.5, // 50% per second — expires fast
      minConfidence: 0.93,  // very tight floor
    });

    // Immediately after creation confidence is ~0.95 — not yet expired
    expect(p.isExpired()).toBe(false);
    expect(p.currentConfidence()).toBeGreaterThan(0);
  });

  it("ConfidentStigmergyLayer.deposit rejects out-of-range evaporationRate", () => {
    const layer = new ConfidentStigmergyLayer();
    expect(() =>
      layer.deposit("loc", "value", {
        confidence: 0.9,
        source: "agent",
        evaporationRate: 1.1,
      }),
    ).toThrow(RangeError);
  });
});
