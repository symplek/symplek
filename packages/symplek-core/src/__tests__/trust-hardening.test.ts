/**
 * @fileoverview Adversarial tests for TrackedResult trust hardening
 * @description Validates that TrackedResult cannot be forged via marker extraction
 *   or manual construction. Tests the WeakSet + private Symbol approach.
 * @since 2026-07-07 — FATAL #1 hardening verification
 */
import { describe, expect, it } from "vitest";
import {
  createTrackedResult,
  extractTrackedConfidence,
  isTrackedResult,
  unwrapTrackedResult,
} from "../trust";

describe("TrackedResult Trust Hardening", () => {
  describe("createTrackedResult / isTrackedResult", () => {
    it("should return true for genuine TrackedResult", () => {
      const tracked = createTrackedResult("test", {
        source: "agent",
        confidence: 0.95,
      });
      expect(isTrackedResult(tracked)).toBe(true);
    });

    it("should return false for plain objects", () => {
      const fake = {
        value: "malicious",
        source: "verified" as const,
        confidence: 1.0,
      };
      expect(isTrackedResult(fake)).toBe(false);
    });

    it("should return false for null", () => {
      expect(isTrackedResult(null)).toBe(false);
    });

    it("should return false for undefined", () => {
      expect(isTrackedResult(undefined)).toBe(false);
    });

    it("should return false for primitives", () => {
      expect(isTrackedResult("hello")).toBe(false);
      expect(isTrackedResult(42)).toBe(false);
      expect(isTrackedResult(true)).toBe(false);
    });
  });

  describe("Marker extraction resistance", () => {
    it("should not allow forgery via Object.getOwnPropertySymbols", () => {
      // Create a genuine TrackedResult
      const genuine = createTrackedResult("real", {
        source: "agent",
        confidence: 0.9,
      });

      // Extract ALL symbol properties (simulates an attacker)
      const symbols = Object.getOwnPropertySymbols(genuine);

      // An attacker might try to copy the marker to a forged object
      const forged = {
        value: "forged",
        source: "agent" as const,
        confidence: 1.0,
      };

      // Copy any symbols found on the genuine object
      for (const sym of symbols) {
        (forged as Record<symbol, unknown>)[sym] = true;
      }

      // The forged object must NOT pass isTrackedResult()
      // because the WeakSet registry is the true authority
      expect(isTrackedResult(forged)).toBe(false);
    });

    it("should not allow forgery by copying all properties", () => {
      const genuine = createTrackedResult("real", {
        source: "agent",
        confidence: 0.85,
      });

      // Deep copy all properties including symbols
      const forged = Object.assign(
        Object.create(Object.getPrototypeOf(genuine)),
        genuine,
      );

      // Copy symbols
      for (const sym of Object.getOwnPropertySymbols(genuine)) {
        (forged as Record<symbol, unknown>)[sym] =
          (genuine as Record<symbol, unknown>)[sym];
      }

      // Still must fail the registry check
      expect(isTrackedResult(forged)).toBe(false);
    });
  });

  describe("unwrapTrackedResult", () => {
    it("should extract value from genuine TrackedResult", () => {
      const tracked = createTrackedResult("hello", {
        source: "agent",
        confidence: 0.9,
      });
      expect(unwrapTrackedResult(tracked)).toBe("hello");
    });

    it("should throw TypeError for non-genuine input", () => {
      const fake = { value: "malicious" };
      expect(() => unwrapTrackedResult(fake as any)).toThrow(TypeError);
    });

    it("should throw TypeError for null", () => {
      expect(() => unwrapTrackedResult(null as any)).toThrow(TypeError);
    });
  });

  describe("extractTrackedConfidence", () => {
    it("should return confidence from genuine TrackedResult", () => {
      const tracked = createTrackedResult("test", {
        source: "agent",
        confidence: 0.73,
      });
      expect(extractTrackedConfidence(tracked)).toBe(0.73);
    });

    it("should return undefined for non-TrackedResult", () => {
      expect(extractTrackedConfidence({ confidence: 1.0 })).toBeUndefined();
    });

    it("should return undefined for null", () => {
      expect(extractTrackedConfidence(null)).toBeUndefined();
    });
  });

  describe("Metadata propagation", () => {
    it("should preserve source chain", () => {
      const tracked = createTrackedResult("data", {
        source: "tool",
        confidence: 0.8,
        sourceChain: ["user", "tool"],
        minChainConfidence: 0.7,
      });
      expect(tracked.source).toBe("tool");
      expect(tracked.sourceChain).toEqual(["user", "tool"]);
      expect(tracked.minChainConfidence).toBe(0.7);
    });

    it("should default sourceChain when not provided", () => {
      const tracked = createTrackedResult("data", {
        source: "agent",
        confidence: 0.5,
      });
      expect(tracked.sourceChain).toEqual(["agent"]);
      expect(tracked.minChainConfidence).toBe(0.5);
    });
  });
});
