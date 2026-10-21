/**
 * README import-name contract test — @symplek/testing
 *
 * Verifies that every name the README says is importable from "@symplek/testing"
 * or "@symplek/core" actually exists in the dist. Introduced after audit B12/T13
 * found the original README claimed APIs that do not exist anywhere.
 *
 * Run with: pnpm --filter @symplek/testing test
 */
import * as testingDist from "../index";
import * as symplekCore from "@symplek/core";
import { describe, it, expect } from "vitest";

// ── Names the README says it exports from "@symplek/testing" ─────────────────────
// README export table: TraceRecorder, TraceReplayer, TestHarness, createTestHarness,
//   TraceVersionError, ReplayDivergenceError, DeterminismError

describe("@symplek/testing README — primary exports exist in dist", () => {
  it("TraceRecorder is exported", () => {
    expect(typeof testingDist.TraceRecorder).toBe("function");
  });

  it("TraceReplayer is exported", () => {
    expect(typeof testingDist.TraceReplayer).toBe("function");
  });

  it("TestHarness is exported", () => {
    expect(typeof testingDist.TestHarness).toBe("function");
  });

  it("createTestHarness is exported", () => {
    expect(typeof testingDist.createTestHarness).toBe("function");
  });

  it("TraceVersionError is exported", () => {
    expect(typeof testingDist.TraceVersionError).toBe("function");
  });

  it("ReplayDivergenceError is exported", () => {
    expect(typeof testingDist.ReplayDivergenceError).toBe("function");
  });

  it("DeterminismError is exported", () => {
    expect(typeof testingDist.DeterminismError).toBe("function");
  });
});

// ── Names the README says it imports from "@symplek/core" ────────────────────────
// README code example: import { AgentUnit, createContext } from "@symplek/core"

describe("@symplek/testing README — @symplek/core imports exist", () => {
  it("AgentUnit exists in @symplek/core", () => {
    expect(typeof symplekCore.AgentUnit).toBe("function");
  });

  it("createContext exists in @symplek/core", () => {
    expect(typeof symplekCore.createContext).toBe("function");
  });
});

// ── AgentUnit API the README relies on ───────────────────────────────────────
// README uses: unit.rehearse(), unit.replay(trace)

describe("@symplek/testing README — AgentUnit rehearsal operators exist", () => {
  it("AgentUnit.prototype.rehearse is a function", () => {
    expect(typeof symplekCore.AgentUnit.prototype.rehearse).toBe("function");
  });

  it("AgentUnit.prototype.replay is a function", () => {
    expect(typeof symplekCore.AgentUnit.prototype.replay).toBe("function");
  });
});

// ── Fictional APIs confirmed absent (regression guard) ───────────────────────
// The original README claimed these; they were removed in the README rewrite.
// These tests catch any accidental re-introduction of false documentation.

describe("@symplek/testing — removed fictional APIs stay absent", () => {
  it("createMockProvider is NOT exported from @symplek/testing", () => {
    expect("createMockProvider" in testingDist).toBe(false);
  });

  it("injectChaos is NOT exported from @symplek/testing", () => {
    expect("injectChaos" in testingDist).toBe(false);
  });

  it("createVote is NOT exported from @symplek/testing", () => {
    expect("createVote" in testingDist).toBe(false);
  });

  it("createConsensusInput is NOT exported from @symplek/testing", () => {
    expect("createConsensusInput" in testingDist).toBe(false);
  });

  it("configureProvider is NOT exported from @symplek/core", () => {
    expect("configureProvider" in symplekCore).toBe(false);
  });
});
