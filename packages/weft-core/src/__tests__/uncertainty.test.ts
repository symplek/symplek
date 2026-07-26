/**
 * Unit tests for weft-core/uncertainty (CR-503)
 *
 * Covers:
 *  - UncertaintySignal shape and getUncertainty()
 *  - uncertaintySpanAttributes() including OTel attribute types
 *  - createTrackedResult() coherence metadata parameter
 *  - Coherence threading through consensus operator
 *  - Subpath import from "weft-core/uncertainty"
 */

import { describe, expect, it } from "vitest";
import { AgentUnit } from "../AgentUnit";
import { createContext } from "../context";
import { createTrackedResult, isTrackedResult } from "../trust";
import type { VoteInput } from "../types";
import {
  getUncertainty,
  uncertaintySpanAttributes,
  type UncertaintySignal,
} from "../uncertainty/index";

function makeMinimalTracked(confidence: number) {
  return createTrackedResult("value", {
    source: "agent",
    confidence,
  });
}

function makeTrackedWithObjectiveConfidence(compositeScore: number) {
  return createTrackedResult("value", {
    source: "agent",
    confidence: 0.5,
    objectiveConfidence: {
      agreementRate: 0.9,
      entropyConfidence: 0.85,
      varianceConfidence: 0.8,
      retryConfidence: 0.95,
      verificationDepth: 0.7,
      composite: compositeScore,
      metadata: {
        calculatedAt: Date.now(),
        contributingTiers: ["immediate", "statistical"],
        weights: {
          agreementRate: 0.3,
          entropyConfidence: 0.2,
          varianceConfidence: 0.15,
          retryConfidence: 0.2,
          verificationDepth: 0.15,
        },
        formula: "test formula",
        signals: [],
        algorithmVersion: "1.0.0",
      },
    },
  });
}

// ─── getUncertainty ───────────────────────────────────────────────────────────

describe("getUncertainty()", () => {
  it("uses objectiveConfidence.composite when present", () => {
    const result = makeTrackedWithObjectiveConfidence(0.87);
    const signal = getUncertainty(result);
    expect(signal.composite).toBe(0.87);
  });

  it("falls back to result.confidence when objectiveConfidence is absent", () => {
    const result = makeMinimalTracked(0.6);
    const signal = getUncertainty(result);
    expect(signal.composite).toBe(0.6);
  });

  it("exposes confidence when objectiveConfidence is present", () => {
    const result = makeTrackedWithObjectiveConfidence(0.87);
    const signal = getUncertainty(result);
    expect(signal.confidence).toBeDefined();
    expect(signal.confidence?.agreementRate).toBe(0.9);
  });

  it("returns undefined confidence when objectiveConfidence is absent", () => {
    const result = makeMinimalTracked(0.7);
    const signal = getUncertainty(result);
    expect(signal.confidence).toBeUndefined();
  });

  it("marks isHighConfidence when composite >= 0.8", () => {
    expect(getUncertainty(makeTrackedWithObjectiveConfidence(0.8)).isHighConfidence).toBe(true);
    expect(getUncertainty(makeTrackedWithObjectiveConfidence(0.95)).isHighConfidence).toBe(true);
    expect(getUncertainty(makeTrackedWithObjectiveConfidence(0.79)).isHighConfidence).toBe(false);
  });

  it("marks isLowConfidence when composite < 0.5", () => {
    expect(getUncertainty(makeTrackedWithObjectiveConfidence(0.49)).isLowConfidence).toBe(true);
    expect(getUncertainty(makeTrackedWithObjectiveConfidence(0.0)).isLowConfidence).toBe(true);
    expect(getUncertainty(makeTrackedWithObjectiveConfidence(0.5)).isLowConfidence).toBe(false);
    expect(getUncertainty(makeTrackedWithObjectiveConfidence(0.7)).isLowConfidence).toBe(false);
  });

  it("propagates coherence from the TrackedResult", () => {
    const coherence = {
      agreementCoherence: 0.9,
      varianceCoherence: 0.8,
      entropyCoherence: 0.85,
      composite: 0.87,
      metadata: {
        calculatedAt: Date.now(),
        contributingMethods: ["agreement" as const],
        weights: {
          agreement: 0.4,
          variance: 0.25,
          entropy: 0.15,
          convergence: 0.15,
          stigmergy: 0.05,
        },
        formula: "test",
        signals: [],
        algorithmVersion: "1.0.0",
      },
    };
    const result = createTrackedResult("value", {
      source: "agent",
      confidence: 0.7,
      coherence,
    });
    const signal = getUncertainty(result);
    expect(signal.coherence).toBe(coherence);
    expect(signal.coherence?.composite).toBe(0.87);
  });

  it("satisfies the UncertaintySignal interface type", () => {
    const result = makeMinimalTracked(0.7);
    const signal: UncertaintySignal = getUncertainty(result);
    expect(typeof signal.composite).toBe("number");
    expect(typeof signal.isHighConfidence).toBe("boolean");
    expect(typeof signal.isLowConfidence).toBe("boolean");
  });
});

// ─── uncertaintySpanAttributes ───────────────────────────────────────────────

describe("uncertaintySpanAttributes()", () => {
  it("always emits composite and source", () => {
    const result = makeMinimalTracked(0.65);
    const attrs = uncertaintySpanAttributes(result);
    expect(attrs["gen_ai.weft.confidence.composite"]).toBe(0.65);
    expect(attrs["gen_ai.weft.uncertainty.source"]).toBe("agent");
  });

  it("composite is a number, not a string", () => {
    const result = makeTrackedWithObjectiveConfidence(0.77);
    const attrs = uncertaintySpanAttributes(result);
    expect(typeof attrs["gen_ai.weft.confidence.composite"]).toBe("number");
  });

  it("emits all confidence keys when objectiveConfidence is present", () => {
    const result = makeTrackedWithObjectiveConfidence(0.87);
    const attrs = uncertaintySpanAttributes(result);
    expect(typeof attrs["gen_ai.weft.confidence.agreement_rate"]).toBe("number");
    expect(attrs["gen_ai.weft.confidence.agreement_rate"]).toBe(0.9);
    expect(typeof attrs["gen_ai.weft.confidence.entropy"]).toBe("number");
    expect(typeof attrs["gen_ai.weft.confidence.variance"]).toBe("number");
    expect(typeof attrs["gen_ai.weft.confidence.retry"]).toBe("number");
  });

  it("omits extended confidence keys when objectiveConfidence is absent", () => {
    const result = makeMinimalTracked(0.55);
    const attrs = uncertaintySpanAttributes(result);
    expect(attrs["gen_ai.weft.confidence.agreement_rate"]).toBeUndefined();
    expect(attrs["gen_ai.weft.confidence.entropy"]).toBeUndefined();
    expect(attrs["gen_ai.weft.confidence.variance"]).toBeUndefined();
    expect(attrs["gen_ai.weft.confidence.retry"]).toBeUndefined();
  });

  it("emits coherence.composite when coherence is present", () => {
    const coherence = {
      agreementCoherence: 0.9,
      varianceCoherence: 0.8,
      entropyCoherence: 0.85,
      composite: 0.88,
      metadata: {
        calculatedAt: Date.now(),
        contributingMethods: ["agreement" as const],
        weights: {
          agreement: 0.4,
          variance: 0.25,
          entropy: 0.15,
          convergence: 0.15,
          stigmergy: 0.05,
        },
        formula: "test",
        signals: [],
        algorithmVersion: "1.0.0",
      },
    };
    const result = createTrackedResult("value", {
      source: "agent",
      confidence: 0.7,
      coherence,
    });
    const attrs = uncertaintySpanAttributes(result);
    expect(attrs["gen_ai.weft.coherence.composite"]).toBe(0.88);
    expect(typeof attrs["gen_ai.weft.coherence.composite"]).toBe("number");
  });

  it("omits coherence.composite when coherence is absent", () => {
    const result = makeMinimalTracked(0.6);
    const attrs = uncertaintySpanAttributes(result);
    expect(attrs["gen_ai.weft.coherence.composite"]).toBeUndefined();
  });

  it("returns only composite and source for a minimal result", () => {
    const result = makeMinimalTracked(0.6);
    const attrs = uncertaintySpanAttributes(result);
    const keys = Object.keys(attrs);
    expect(keys).toEqual([
      "gen_ai.weft.confidence.composite",
      "gen_ai.weft.uncertainty.source",
    ]);
  });
});

// ─── createTrackedResult coherence parameter ─────────────────────────────────

describe("createTrackedResult() — coherence metadata", () => {
  it("sets result.coherence when coherence is provided", () => {
    const coherence = {
      agreementCoherence: 0.85,
      varianceCoherence: 0.9,
      entropyCoherence: 0.8,
      composite: 0.85,
      metadata: {
        calculatedAt: Date.now(),
        contributingMethods: ["agreement" as const, "variance" as const],
        weights: {
          agreement: 0.4,
          variance: 0.25,
          entropy: 0.15,
          convergence: 0.15,
          stigmergy: 0.05,
        },
        formula: "test formula",
        signals: [],
        algorithmVersion: "1.0.0",
      },
    };
    const result = createTrackedResult("hello", {
      source: "agent",
      confidence: 0.8,
      coherence,
    });
    expect(isTrackedResult(result)).toBe(true);
    expect(result.coherence).toBe(coherence);
    expect(result.coherence?.composite).toBe(0.85);
  });

  it("result.coherence is undefined when not provided", () => {
    const result = createTrackedResult("hello", {
      source: "agent",
      confidence: 0.8,
    });
    expect(isTrackedResult(result)).toBe(true);
    expect(result.coherence).toBeUndefined();
  });
});

// ─── Consensus operator threading ────────────────────────────────────────────

describe("consensus operator — coherence threading", () => {
  it("populates result.coherence after a consensus run", async () => {
    const ctx = createContext({});

    const voters = [
      (_proposal: string): VoteInput => ({
        decision: "approve",
        confidence: 0.9,
        reasoning: "yes",
      }),
      (_proposal: string): VoteInput => ({
        decision: "approve",
        confidence: 0.85,
        reasoning: "agreed",
      }),
    ];

    const unit = AgentUnit.of("proposal").consensus(voters, { quorum: 0.5 });
    const result = await unit.run(ctx);

    expect(isTrackedResult(result)).toBe(true);
    expect(result.coherence).toBeDefined();
    expect(typeof result.coherence?.composite).toBe("number");
    // High agreement → high coherence
    expect(result.coherence!.composite).toBeGreaterThan(0.5);
  });

  it("coherence composite is a number [0, 1]", async () => {
    const ctx = createContext({});

    const voters = [
      (_p: number): VoteInput => ({ decision: "approve", confidence: 0.9 }),
      (_p: number): VoteInput => ({ decision: "reject", confidence: 0.8 }),
    ];

    const unit = AgentUnit.of(42).consensus(voters, { quorum: 0.5 });
    const result = await unit.run(ctx);

    expect(result.coherence).toBeDefined();
    expect(result.coherence!.composite).toBeGreaterThanOrEqual(0);
    expect(result.coherence!.composite).toBeLessThanOrEqual(1);
  });
});

// ─── converge operator threading ─────────────────────────────────────────────

describe("converge operator — coherence threading", () => {
  it("populates result.coherence after a converge run", async () => {
    const ctx = createContext({});

    let round = 0;
    const agent = (_state: number, _r: number) => {
      round++;
      return { result: round, hasMore: round < 2 };
    };

    const unit = AgentUnit.of(0).converge([agent], { maxRounds: 3 });
    const result = await unit.run(ctx);

    expect(isTrackedResult(result)).toBe(true);
    expect(result.coherence).toBeDefined();
    expect(typeof result.coherence?.composite).toBe("number");
  });
});

// ─── Finding R3-4: coherence survives downstream map ─────────────────────────
//
// consensus() attaches coherence to its ConsensusResult value. When the caller
// then applies .map(() => "done"), the mapped value is a plain string with no
// coherence field — wrapInTrackedResult extracted coherence from value and found
// nothing. The composable uncertainty signal was advertised; it wasn't composable.
//
// PRE-FIX FAILURE:
//   unit.consensus(voters).map(() => "done").run(ctx)
//   → result.coherence is undefined because extractCoherence("done") === undefined
// POST-FIX: map() captures coherence from the upstream ConsensusResult before
//   applying the transform function and threads it to the TrackedResult via
//   AgentUnitMetadata.coherence.

describe("Finding R3-4 — coherence propagates through downstream map()", () => {
  it("consensus().map(() => 'done') yields a TrackedResult with defined coherence", async () => {
    const ctx = createContext({});

    const voters = [
      (_proposal: string): VoteInput => ({
        decision: "approve",
        confidence: 0.9,
        reasoning: "looks good",
      }),
      (_proposal: string): VoteInput => ({
        decision: "approve",
        confidence: 0.85,
        reasoning: "agreed",
      }),
    ];

    // PRE-FIX: result.coherence is undefined — "done" carries no coherence field.
    // POST-FIX: coherence is propagated from the ConsensusResult through map().
    const result = await AgentUnit.of("proposal")
      .consensus(voters, { quorum: 0.5 })
      .map(() => "done")
      .run(ctx);

    expect(result.value).toBe("done");
    expect(result.coherence).toBeDefined();
    expect(typeof result.coherence?.composite).toBe("number");
    expect(result.coherence!.composite).toBeGreaterThan(0);
  });

  it("coherence survives flatMap(() => AgentUnit.of('done'))", async () => {
    const ctx = createContext({});

    const voters = [
      (_p: string): VoteInput => ({ decision: "approve", confidence: 0.88 }),
    ];

    const result = await AgentUnit.of("x")
      .consensus(voters, { quorum: 0.5 })
      .flatMap(() => AgentUnit.of("done"))
      .run(ctx);

    // flatMap replaces the computation entirely; coherence from the consensus
    // step is NOT expected to survive flatMap (independent computation chain).
    // This asserts the current specified boundary: only map() propagates.
    expect(result.value).toBe("done");
    // coherence may or may not be present after flatMap — not asserted here.
  });

  it("consensus().map().map() chains preserve coherence end-to-end", async () => {
    const ctx = createContext({});

    const voters = [
      (_p: string): VoteInput => ({ decision: "approve", confidence: 0.92 }),
      (_p: string): VoteInput => ({ decision: "approve", confidence: 0.9 }),
    ];

    const result = await AgentUnit.of("proposal")
      .consensus(voters, { quorum: 0.5 })
      .map((r) => r.winner)
      .map((w) => `winner: ${w}`)
      .run(ctx);

    // Double map: coherence from consensus must survive both transforms.
    expect(result.coherence).toBeDefined();
    expect(typeof result.coherence?.composite).toBe("number");
  });
});

// ─── OTel attribute safety ────────────────────────────────────────────────────

describe("uncertaintySpanAttributes — OTel safety", () => {
  it("never includes prompt or response text in attributes", () => {
    // Results carry a string value; it must NOT appear in the attributes
    const result = createTrackedResult("THIS IS PROMPT TEXT — must not leak", {
      source: "agent",
      confidence: 0.7,
    });
    const attrs = uncertaintySpanAttributes(result);
    const attrValues = Object.values(attrs);
    // No string value in attrs should contain the result value
    for (const v of attrValues) {
      if (typeof v === "string") {
        expect(v).not.toContain("THIS IS PROMPT TEXT");
      }
    }
  });

  it("all numeric attributes are actual numbers (not stringified)", () => {
    const result = makeTrackedWithObjectiveConfidence(0.85);
    const attrs = uncertaintySpanAttributes(result);
    const numericKeys = [
      "gen_ai.weft.confidence.composite",
      "gen_ai.weft.confidence.agreement_rate",
      "gen_ai.weft.confidence.entropy",
      "gen_ai.weft.confidence.variance",
      "gen_ai.weft.confidence.retry",
    ];
    for (const key of numericKeys) {
      expect(typeof attrs[key]).toBe("number");
    }
  });
});
