/**
 * @module provenance.test - Per-tool confidence differentiation and requireMinChainConfidence gate
 * @description Verifies that:
 *   1. Sources above the threshold do not throw (WebFetch at 0.85 > 0.75 threshold)
 *   2. Sources below the threshold throw LowProvenanceError with correct fields
 *   3. Per-tool confidence values are assigned correctly (WebFetch=0.85, WebSearch=0.70)
 * @rules @.cursor/rules/patterns/029-file-header-contracts.mdc
 */

import { createContext } from "@weft/core";
import { describe, expect, it } from "vitest";
import { LowProvenanceError } from "../errors";
import { makePlanUnit } from "../operators/plan";
import type { HarnessConfig } from "../types";

// ─── Helpers ─────────────────────────────────────────────────────────────────

const ctx = createContext();
const config: HarnessConfig = { adapter: "claude-agent-sdk" };

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("requireMinChainConfidence gate", () => {
  it("does not throw when all sources are above the threshold", async () => {
    // WebFetch confidence = 0.85; threshold = 0.75 → should pass
    const unit = makePlanUnit("test intent", { tools: ["WebFetch"] }, config);
    const gated = unit.requireMinChainConfidence(0.75);

    // zero-trust run returns TrackedResult<TrackedResult<PlanArtifact>>
    await expect(gated.run(ctx)).resolves.toBeDefined();
  });

  it("throws LowProvenanceError with correct fields when mean confidence is below threshold", async () => {
    // WebSearch confidence = 0.70; threshold = 0.9 → should fail
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
    expect(err.actual).toBeCloseTo(0.7, 5);
    // sourceChain: ["tool"] → length 1
    expect(err.sourceCount).toBe(1);
    expect(err.message).toContain("0.700");
    expect(err.message).toContain("0.9");
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
    // result shape: TrackedResult<TrackedResult<PlanArtifact>> (outer = zero-trust wrap)
    const fetchArtifact = fetchResult.value.value;

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
    const searchArtifact = searchResult.value.value;

    expect(searchArtifact.sources).toHaveLength(1);
    expect(searchArtifact.sources[0].confidence).toBe(0.7);
    expect(searchArtifact.sources[0].kind).toBe("web");
    expect(searchArtifact.sources[0].contentHash).toHaveLength(12);

    // ── Read (file tool) ──────────────────────────────────────────────────────
    const readUnit = makePlanUnit("read intent", { tools: ["Read"] }, config);
    const readResult = await readUnit.run(ctx);
    const readArtifact = readResult.value.value;

    expect(readArtifact.sources).toHaveLength(1);
    expect(readArtifact.sources[0].confidence).toBe(0.8);
    expect(readArtifact.sources[0].kind).toBe("file");
    expect(readArtifact.sources[0].contentHash).toHaveLength(12);
  });
});
