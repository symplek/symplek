/**
 * @module provenance.test - Per-tool confidence differentiation and requireMinChainConfidence gate
 * @description Verifies that:
 *   1. Sources above the threshold do not throw (WebFetch at 0.85 > 0.75 threshold)
 *   2. Sources below the threshold throw LowProvenanceError with correct fields
 *   3. Per-tool confidence values are assigned correctly (WebFetch=0.85, WebSearch=0.70)
 * @rules @.cursor/rules/patterns/029-file-header-contracts.mdc
 */

import { describe, expect, it } from "vitest";
import { createContext } from "@symplek/core";
import { LowProvenanceError } from "../errors";
import { makePlanUnit } from "../operators/plan";
import type { HarnessConfig } from "../types";

// ─── Helpers ─────────────────────────────────────────────────────────────────

const ctx = createContext();
const config: HarnessConfig = { adapter: "claude-agent-sdk" };

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("requireMinChainConfidence gate", () => {
  // CORRECTED (H9): The old behavior allowed synthesized plans to pass the gate
  // because they carried heuristic confidences (e.g. WebFetch=0.85 > 0.75).
  // Synthesized plans have no real provenance. The gate now rejects ALL
  // synthesized plans regardless of their heuristic confidence values.
  it("throws LowProvenanceError for any synthesized plan (H9 correction)", async () => {
    // WebFetch heuristic confidence = 0.85; threshold = 0.75.
    // OLD (defective): would resolve because 0.85 > 0.75.
    // NEW (correct): throws because the plan is synthesized — no SDK was wired.
    const unit = makePlanUnit("test intent", { tools: ["WebFetch"] }, config);
    const gated = unit.requireMinChainConfidence(0.75);

    await expect(gated.run(ctx)).rejects.toBeInstanceOf(LowProvenanceError);
  });

  it("throws LowProvenanceError naming synthesized as the reason when no SDK is wired", async () => {
    // CORRECTED (H9): the error now says "synthesized" and reports actual=0,
    // not the heuristic confidence of the invented source.
    const unit = makePlanUnit("test intent", { tools: ["WebSearch"] }, config);
    const gated = unit.requireMinChainConfidence(0.9);

    let caught: unknown;
    try {
      await gated.run(ctx);
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(LowProvenanceError);
    const err = caught as LowProvenanceError;
    expect(err.threshold).toBe(0.9);
    // actual is 0 because synthesized plans have no real confidence
    expect(err.actual).toBe(0);
    expect(err.message).toMatch(/synthesized/i);
  });
});

// ─── H9: requireMinChainConfidence rejects synthesized plans ─────────────────
// Before this fix: a synthesized plan with confidence 0.8 passed
// requireMinChainConfidence(0.8) because mean===threshold used strict less-than.
// A synthesized plan has no real provenance; the gate must reject it.

describe("H9 — requireMinChainConfidence rejects synthesized plans", () => {
  it("throws LowProvenanceError for a synthesized plan regardless of heuristic confidence", async () => {
    // stub plan with Read (heuristic confidence 0.8); threshold 0.8 should now fail
    // because the plan is synthesized — sources are invented, not executed
    const unit = makePlanUnit("synthesized test", { tools: ["Read"] }, config);
    const gated = unit.requireMinChainConfidence(0.8);

    await expect(gated.run(ctx)).rejects.toBeInstanceOf(LowProvenanceError);
  });

  it("the error message names synthesized as the reason", async () => {
    const unit = makePlanUnit("synthesized test", { tools: ["WebFetch"] }, config);
    const gated = unit.requireMinChainConfidence(0.5); // even below heuristic confidence

    let caught: unknown;
    try {
      await gated.run(ctx);
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(LowProvenanceError);
    expect((caught as LowProvenanceError).message).toMatch(/synthesized/i);
  });
});

describe("per-tool source confidence values", () => {
  it("assigns WebFetch confidence=0.85, WebSearch confidence=0.70, file tool confidence=0.80", async () => {
    // ── WebFetch ─────────────────────────────────────────────────────────────
    const fetchUnit = makePlanUnit(
      "fetch intent",
      { tools: ["WebFetch"] },
      config,
    );
    const fetchResult = await fetchUnit.run(ctx);
    // FIXED (N70): result shape is TrackedResult<PlanArtifact> — single wrap.
    // result.value is the PlanArtifact; no double-wrap via inner createTrackedResult.
    const fetchArtifact = fetchResult.value;

    expect(fetchArtifact.sources).toHaveLength(1);
    expect(fetchArtifact.sources[0].confidence).toBe(0.85);
    expect(fetchArtifact.sources[0].kind).toBe("web");
    expect(fetchArtifact.sources[0].contentHash).toHaveLength(12);

    // ── WebSearch ─────────────────────────────────────────────────────────────
    const searchUnit = makePlanUnit(
      "search intent",
      { tools: ["WebSearch"] },
      config,
    );
    const searchResult = await searchUnit.run(ctx);
    const searchArtifact = searchResult.value; // PlanArtifact — single wrap

    expect(searchArtifact.sources).toHaveLength(1);
    expect(searchArtifact.sources[0].confidence).toBe(0.7);
    expect(searchArtifact.sources[0].kind).toBe("web");
    expect(searchArtifact.sources[0].contentHash).toHaveLength(12);

    // ── Read (file tool) ──────────────────────────────────────────────────────
    const readUnit = makePlanUnit("read intent", { tools: ["Read"] }, config);
    const readResult = await readUnit.run(ctx);
    const readArtifact = readResult.value; // PlanArtifact — single wrap

    expect(readArtifact.sources).toHaveLength(1);
    expect(readArtifact.sources[0].confidence).toBe(0.8);
    expect(readArtifact.sources[0].kind).toBe("file");
    expect(readArtifact.sources[0].contentHash).toHaveLength(12);
  });
});
