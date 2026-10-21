/**
 * README import-name contract test — @symplek/react
 *
 * Verifies that every name the README says is importable from "@symplek/react"
 * actually exists in the dist. The @symplek/react README lists six root exports
 * in a table; this test asserts all six exist.
 *
 * Run with: pnpm --filter @symplek/react test
 */
import * as reactDist from "../index";
import { describe, it, expect } from "vitest";

// ── README export table: AIErrorBoundary, AIProvider, useAIConfig, ────────────
//   useAgent, useConsensus, useSwarm

describe("@symplek/react README — root exports exist in dist", () => {
  it("AIErrorBoundary is exported", () => {
    expect(typeof reactDist.AIErrorBoundary).toBe("function");
  });

  it("AIProvider is exported", () => {
    expect(typeof reactDist.AIProvider).toBe("function");
  });

  it("useAIConfig is exported", () => {
    expect(typeof reactDist.useAIConfig).toBe("function");
  });

  it("useAgent is exported", () => {
    expect(typeof reactDist.useAgent).toBe("function");
  });

  it("useConsensus is exported", () => {
    expect(typeof reactDist.useConsensus).toBe("function");
  });

  it("useSwarm is exported", () => {
    expect(typeof reactDist.useSwarm).toBe("function");
  });
});

// ── README "Not Exported From Root" — hooks that must NOT appear ─────────────
// README explicitly documents these as source-only, not public.

describe("@symplek/react README — source-only hooks stay out of root exports", () => {
  const dist = reactDist as Record<string, unknown>;

  it("useAI is NOT exported from root (source-only per README)", () => {
    expect("useAI" in dist).toBe(false);
  });

  it("useAIQuery is NOT exported from root (source-only per README)", () => {
    expect("useAIQuery" in dist).toBe(false);
  });

  it("useAIStream is NOT exported from root (source-only per README)", () => {
    expect("useAIStream" in dist).toBe(false);
  });
});
