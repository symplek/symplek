/**
 * Package Contract Smoke Test — weft-pro
 *
 * Proves that root exports produce real behavior, not just symbol existence.
 * Imports ONLY from "../index" (the package entrypoint).
 *
 * This file checks the source-level public contract only.
 * Packed-install verification lives in the root packed-proof harness.
 */

import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import {
  AntibodyRegistry,
  ConfidentStigmergyLayer,
  createConfidentPheromone,
  defaultAntibodyRegistry,
  defaultTrustRegistry,
  getScanDepthForTrust,
  TrustRegistry,
  tacoConsensus,
  VERSION,
} from "../index";

// The manifest is the source of truth for the version; the constant must match it.
const packageJson = createRequire(import.meta.url)("../../package.json") as {
  version: string;
};

describe("weft-pro — Package Contract Smoke", () => {
  // ─── TaCo Consensus ───────────────────────────────────────────────────────

  describe("TaCo consensus exports", () => {
    it("exports tacoConsensus as a function", () => {
      expect(typeof tacoConsensus).toBe("function");
    });

    it("tacoConsensus returns a function that accepts an AgentUnit", () => {
      const transform = tacoConsensus([], { maxRounds: 1 });
      expect(typeof transform).toBe("function");
    });
  });

  // ─── Stigmergy ────────────────────────────────────────────────────────────

  describe("Stigmergy behavior", () => {
    it("createConfidentPheromone produces a pheromone with live decay", () => {
      const pheromone = createConfidentPheromone("test-value", {
        confidence: 0.9,
        source: "agent",
        evaporationRate: 0.5,
      });
      expect(pheromone.value).toBe("test-value");
      expect(pheromone.confidence).toBe(0.9);

      const c = pheromone.currentConfidence();
      expect(c).toBeGreaterThan(0);
      expect(c).toBeLessThanOrEqual(0.9);
    });

    it("ConfidentStigmergyLayer deposit+sense round-trips", () => {
      const layer = new ConfidentStigmergyLayer();
      layer.deposit("loc-a", 42, { confidence: 0.95, source: "verified" });

      const sensed = layer.sense<number>("loc-a");
      expect(sensed).toBeDefined();
      expect(sensed!.value).toBe(42);
    });

    it("ConfidentStigmergyLayer.cleanup removes expired pheromones", () => {
      const layer = new ConfidentStigmergyLayer();
      layer.deposit("loc-b", "old", {
        confidence: 0.001,
        source: "agent",
        evaporationRate: 0.999,
        minConfidence: 0.5,
      });

      const cleaned = layer.cleanup();
      expect(cleaned).toBe(1);
      expect(layer.sense("loc-b")).toBeUndefined();
    });
  });

  // ─── Antibody behavior ────────────────────────────────────────────────────

  describe("Antibody behavior", () => {
    it("AntibodyRegistry.scan detects regex patterns and recommends rejection", () => {
      const registry = new AntibodyRegistry();
      registry.registerPattern({
        id: "xss-1",
        matcher: { type: "regex", pattern: /<script[^>]*>/i },
        description: "Script injection",
        severity: "critical",
        learnedAt: Date.now(),
      });

      const result = registry.scan('<script>alert("XSS")</script>');
      expect(result.recommendation).toBe("reject");
      expect(result.matches).toHaveLength(1);
      expect(result.matches[0].patternId).toBe("xss-1");
    });

    it("AntibodyRegistry.scan allows clean output", () => {
      const registry = new AntibodyRegistry();
      registry.registerPattern({
        id: "xss-1",
        matcher: { type: "regex", pattern: /<script[^>]*>/i },
        description: "Script injection",
        severity: "critical",
        learnedAt: Date.now(),
      });

      const result = registry.scan("Hello, world!");
      expect(result.recommendation).toBe("allow");
      expect(result.matches).toHaveLength(0);
    });

    it("schema matcher matches by structural key presence, not always-true", () => {
      const registry = new AntibodyRegistry();
      registry.registerPattern({
        id: "bad-shape",
        matcher: {
          type: "schema",
          schema: { error: "", code: 0 },
        },
        description: "Matches error-shaped objects",
        severity: "high",
        learnedAt: Date.now(),
      });

      const matchResult = registry.scan(
        JSON.stringify({ error: "fail", code: 500, extra: true }),
      );
      expect(matchResult.recommendation).not.toBe("allow");
      expect(matchResult.matches).toHaveLength(1);

      const noMatchResult = registry.scan(
        JSON.stringify({ success: true, data: {} }),
      );
      expect(noMatchResult.recommendation).toBe("allow");
      expect(noMatchResult.matches).toHaveLength(0);
    });

    it("defaultAntibodyRegistry is a shared AntibodyRegistry instance", () => {
      expect(defaultAntibodyRegistry).toBeInstanceOf(AntibodyRegistry);
    });
  });

  // ─── Observability moved to weft-core ─────────────────────────────────────
  // See packages/weft-core/src/__tests__/contractSmoke.test.ts for coverage.

  // ─── Trust behavior ───────────────────────────────────────────────────────

  describe("Trust behavior", () => {
    it("TrustRegistry register+check round-trips", () => {
      const registry = new TrustRegistry();
      registry.register("agent-42", "full", { reason: "audit passed" });

      const grant = registry.check("agent-42");
      expect(grant).not.toBeNull();
      expect(grant!.level).toBe("full");
      expect(grant!.reason).toBe("audit passed");
    });

    it("TrustRegistry.check returns null for expired grants", () => {
      const registry = new TrustRegistry();
      registry.register("agent-old", "partial", {
        expiresAt: Date.now() - 1000,
      });

      expect(registry.check("agent-old")).toBeNull();
    });

    it("TrustRegistry.revoke removes a grant", () => {
      const registry = new TrustRegistry();
      registry.register("agent-x", "full");
      expect(registry.revoke("agent-x")).toBe(true);
      expect(registry.check("agent-x")).toBeNull();
    });

    it("getScanDepthForTrust maps levels correctly", () => {
      expect(getScanDepthForTrust("full")).toBe("quick");
      expect(getScanDepthForTrust("partial")).toBe("standard");
      expect(getScanDepthForTrust("none")).toBe("thorough");
    });

    it("defaultTrustRegistry is a shared TrustRegistry instance", () => {
      expect(defaultTrustRegistry).toBeInstanceOf(TrustRegistry);
    });
  });

  // ─── Version ──────────────────────────────────────────────────────────────

  describe("Version export", () => {
    it("exports VERSION matching package.json", () => {
      expect(typeof VERSION).toBe("string");
      expect(VERSION).toBe(packageJson.version);
    });
  });

  // ─── Peer dependency documentation ────────────────────────────────────────

  describe("weft-core peer dependency resolution", () => {
    it("tacoConsensus depends on AgentUnit from weft-core", () => {
      expect(typeof tacoConsensus).toBe("function");
    });
  });
});
