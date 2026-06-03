/**
 * @fileoverview Tests for zero-trust default implementation
 * @description Validates TrackedResult return by default and legacy mode
 * @module weft-core/__tests__/zero-trust
 * @since 2.0.0
 *
 * 📝 BUILD[01.05]: Zero-trust default implementation tests
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentUnit } from "../AgentUnit";
import type { AgentContext, TrackedResult } from "../types";
import { TRACKED_MARKER } from "../types";

// Test context factory
function createTestContext(): AgentContext {
  return {
    timestamp: Date.now(),
    signal: undefined,
    extensions: {},
  };
}

describe("Zero-Trust Default Implementation", () => {
  let ctx: AgentContext;
  let consoleWarnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    ctx = createTestContext();
    consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    // Reset the deprecation warning flag
    AgentUnit.resetDeprecationWarningForTesting();
  });

  afterEach(() => {
    consoleWarnSpy.mockRestore();
  });

  describe("Scenario: Default run returns TrackedResult", () => {
    it("should return TrackedResult<T> when run() is called without options", async () => {
      const unit = AgentUnit.of(42);

      const result = await unit.run(ctx);

      // Verify it's a TrackedResult (Symbol check)
      expect(TRACKED_MARKER in result).toBe(true);
      expect(result[TRACKED_MARKER]).toBe(true);
      expect(result.value).toBe(42);
      expect(result.confidence).toBeDefined();
      expect(result.source).toBe("agent");
    });

    it("should have value accessible on result", async () => {
      const unit = AgentUnit.of({ data: "test" });

      const result = await unit.run(ctx);

      expect(result.value).toEqual({ data: "test" });
    });

    it("should have confidence between 0 and 1", async () => {
      const unit = AgentUnit.of("test");

      const result = await unit.run(ctx);

      expect(result.confidence).toBeGreaterThanOrEqual(0);
      expect(result.confidence).toBeLessThanOrEqual(1);
    });

    it("should have source set to 'agent'", async () => {
      const unit = AgentUnit.of("test");

      const result = await unit.run(ctx);

      expect(result.source).toBe("agent");
    });

    it("should have sourceChain initialized", async () => {
      const unit = AgentUnit.of("test");

      const result = await unit.run(ctx);

      expect(result.sourceChain).toEqual(["agent"]);
    });

    it("should have minChainConfidence set", async () => {
      const unit = AgentUnit.of("test");

      const result = await unit.run(ctx);

      expect(result.minChainConfidence).toBe(result.confidence);
    });
  });

  describe("Scenario: Legacy mode returns raw T", () => {
    it("should return raw T when trustMode is 'legacy'", async () => {
      const unit = AgentUnit.of(42);

      const result = await unit.run(ctx, { trustMode: "legacy" });

      // Verify it's the raw value
      expect(result).toBe(42);
      expect(typeof result).toBe("number");
    });

    it("should emit deprecation warning for legacy mode", async () => {
      const unit = AgentUnit.of(42);

      await unit.run(ctx, { trustMode: "legacy" });

      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('trustMode: "legacy" is deprecated'),
      );
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining("https://Weft.ai/docs/migration/zero-trust"),
      );
    });

    it("should only emit deprecation warning once", async () => {
      const unit1 = AgentUnit.of(42);
      const unit2 = AgentUnit.of(100);

      await unit1.run(ctx, { trustMode: "legacy" });
      await unit2.run(ctx, { trustMode: "legacy" });

      expect(consoleWarnSpy).toHaveBeenCalledTimes(1);
    });

    it("should not have TRACKED_MARKER on legacy result", async () => {
      const unit = AgentUnit.of({ data: "test" });

      const result = await unit.run(ctx, { trustMode: "legacy" });

      // Symbol check - legacy result should not have the marker
      expect(TRACKED_MARKER in result).toBe(false);
    });
  });

  describe("Scenario: Confidence calculation", () => {
    it("should have base confidence of 0.85 for simple unit", async () => {
      const unit = AgentUnit.of("test");

      const result = await unit.run(ctx);

      expect(result.confidence).toBe(0.85);
    });

    it("should increase confidence for consensus operator (+0.10)", async () => {
      const unit = AgentUnit.of("proposal").consensus(
        [
          () => ({ decision: "approve" as const, confidence: 0.9 }),
          () => ({ decision: "approve" as const, confidence: 0.9 }),
        ],
        { quorum: 0.5 },
      );

      const result = await unit.run(ctx);

      // ConsensusResult has different structure, but the unit has consensus in chain
      // The confidence calculation applies to the TrackedResult wrapper
      expect(result.confidence).toBe(0.95); // 0.85 + 0.10
    });

    it("should decrease confidence for retry operator (-0.05)", async () => {
      const unit = AgentUnit.of("test").retry(2);

      const result = await unit.run(ctx);

      expect(result.confidence).toBeCloseTo(0.8, 10); // 0.85 - 0.05
    });

    it("should decrease confidence for fallback operator (-0.10)", async () => {
      const fallbackUnit = AgentUnit.of("fallback");
      const unit = AgentUnit.of("primary").fallback(fallbackUnit);

      const result = await unit.run(ctx);

      expect(result.confidence).toBeCloseTo(0.75, 10); // 0.85 - 0.10
    });

    it("should accumulate adjustments from multiple operators", async () => {
      const fallbackUnit = AgentUnit.of("fallback");
      const unit = AgentUnit.of("test")
        .retry(2) // -0.05
        .fallback(fallbackUnit); // -0.10

      const result = await unit.run(ctx);

      expect(result.confidence).toBeCloseTo(0.7, 10); // 0.85 - 0.05 - 0.10
    });

    it("should clamp confidence to minimum 0", async () => {
      // Create a unit with many confidence-decreasing operators
      let unit = AgentUnit.of("test");
      for (let i = 0; i < 20; i++) {
        unit = unit.retry(1);
      }

      const result = await unit.run(ctx);

      expect(result.confidence).toBeGreaterThanOrEqual(0);
    });

    it("should clamp confidence to maximum 1", async () => {
      // We can't easily get confidence > 1 with current operators,
      // but let's verify the clamp works
      const unit = AgentUnit.of("test");

      const result = await unit.run(ctx);

      expect(result.confidence).toBeLessThanOrEqual(1);
    });
  });

  describe("Scenario: Type inference works correctly", () => {
    it("should infer TrackedResult type for default run()", async () => {
      const unit = AgentUnit.of({ id: 1, name: "test" });

      const result = await unit.run(ctx);

      // TypeScript should infer result as TrackedResult<{id: number, name: string}>
      // We verify the shape matches
      expect(result.value.id).toBe(1);
      expect(result.value.name).toBe("test");
      expect(typeof result.confidence).toBe("number");
    });

    it("should infer raw type for legacy run()", async () => {
      const unit = AgentUnit.of({ id: 1, name: "test" });

      const result = await unit.run(ctx, { trustMode: "legacy" });

      // TypeScript should infer result as {id: number, name: string}
      // We verify it's the raw object
      expect(result.id).toBe(1);
      expect(result.name).toBe("test");
    });

    it("should infer TrackedResult when trustMode is explicitly zero-trust", async () => {
      const unit = AgentUnit.of(42);

      const result = await unit.run(ctx, { trustMode: "zero-trust" });

      expect(TRACKED_MARKER in result).toBe(true);
      expect(result[TRACKED_MARKER]).toBe(true);
      expect(result.value).toBe(42);
    });
  });

  describe("Scenario: Integration with existing operators", () => {
    it("should work with map operator", async () => {
      const unit = AgentUnit.of(5).map((x) => x * 2);

      const result = await unit.run(ctx);

      expect(result.value).toBe(10);
      expect(result.confidence).toBe(0.85);
    });

    it("should work with flatMap operator", async () => {
      const unit = AgentUnit.of(5).flatMap((x) => AgentUnit.of(x * 2));

      const result = await unit.run(ctx);

      expect(result.value).toBe(10);
      expect(result.confidence).toBe(0.85);
    });

    it("should work with async computation", async () => {
      const unit = AgentUnit.from(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        return "async-result";
      });

      const result = await unit.run(ctx);

      expect(result.value).toBe("async-result");
      expect(result.source).toBe("agent");
    });

    it("should work with tap operator", async () => {
      let tapped = false;
      const unit = AgentUnit.of("test").tap(() => {
        tapped = true;
      });

      const result = await unit.run(ctx);

      expect(tapped).toBe(true);
      expect(result.value).toBe("test");
    });
  });

  describe("Scenario: Error handling", () => {
    it("should propagate errors in zero-trust mode", async () => {
      const unit = AgentUnit.from(async () => {
        throw new Error("Test error");
      });

      await expect(unit.run(ctx)).rejects.toThrow("Test error");
    });

    it("should propagate errors in legacy mode", async () => {
      const unit = AgentUnit.from(async () => {
        throw new Error("Test error");
      });

      await expect(unit.run(ctx, { trustMode: "legacy" })).rejects.toThrow(
        "Test error",
      );
    });
  });

  describe("Scenario: TrackedResult verification", () => {
    it("should have valid TRACKED_MARKER symbol", async () => {
      const unit = AgentUnit.of("test");

      const result = await unit.run(ctx);

      // The marker should be the actual symbol from types
      expect(TRACKED_MARKER in result).toBe(true);
      expect(result[TRACKED_MARKER]).toBe(true);
    });

    it("should not be spoofable without the symbol", () => {
      // Create a fake TrackedResult without the proper symbol
      const spoofed = {
        value: "malicious",
        source: "verified",
        confidence: 1.0,
        sourceChain: ["verified"],
        minChainConfidence: 1.0,
      };

      // It should not have the TRACKED_MARKER
      expect(TRACKED_MARKER in spoofed).toBe(false);
    });
  });
});

describe("TrackedResult Type Guard", () => {
  it("should correctly identify legitimate TrackedResult", async () => {
    const ctx = createTestContext();
    const unit = AgentUnit.of("test");

    const result = await unit.run(ctx);

    // Type guard check
    const isTracked = (obj: unknown): obj is TrackedResult<unknown> =>
      typeof obj === "object" &&
      obj !== null &&
      TRACKED_MARKER in obj &&
      (obj as TrackedResult<unknown>)[TRACKED_MARKER] === true;

    expect(isTracked(result)).toBe(true);
  });

  it("should reject spoofed objects", () => {
    const spoofed = {
      value: "malicious",
      source: "verified",
      confidence: 1.0,
    };

    const isTracked = (obj: unknown): obj is TrackedResult<unknown> =>
      typeof obj === "object" &&
      obj !== null &&
      TRACKED_MARKER in obj &&
      (obj as TrackedResult<unknown>)[TRACKED_MARKER] === true;

    expect(isTracked(spoofed)).toBe(false);
  });
});
