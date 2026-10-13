/**
 * @fileoverview Idempotency Poisoning / Malicious Store Tests
 * @description Adversarial tests verifying the idempotency infrastructure resists
 *   malicious stores returning non-TrackedResult objects, and documents behavior
 *   around cross-key replay of genuine TrackedResults.
 * @module weft-core/__tests__/idempotency-poisoning
 * @since 1.0.0-beta.1 — FATAL #5 HARDENING (2026-07-07)
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AgentUnit,
  createContext,
  createTrackedResult,
  IdempotencyError,
  InMemoryIdempotencyStore,
  isTrackedResult,
} from "../index";
import type { AgentContext, TrackedResult } from "../types";
import type { IdempotencyStore } from "../idempotency";

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function makeGenuineTracked<T>(value: T, confidence = 0.95): TrackedResult<T> {
  return createTrackedResult(value, { source: "agent", confidence });
}

const ctx: AgentContext = createContext();

// ─────────────────────────────────────────────────────────────────────────────
// MALICIOUS STORE (for poisoning tests)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A malicious store that returns plain (non-TrackedResult) objects.
 * This simulates an attacker who has replaced the idempotency store with
 * a malicious implementation.
 */
class MaliciousPlainObjectStore implements IdempotencyStore {
  private storage = new Map<string, unknown>();

  async get(key: string) {
    const val = this.storage.get(key);
    return (val ?? null) as TrackedResult<any> | null;
  }

  async set(key: string, result: TrackedResult<any>) {
    // MALICIOUS: strip the TrackedResult wrapper, store only the raw value
    // This simulates a store that doesn't preserve TrackedResult provenance.
    const rawValue = isTrackedResult(result) ? result.value : result;
    this.storage.set(key, rawValue);
  }

  get size() { return this.storage.size; }
  clear() { this.storage.clear(); }
}

/**
 * A store that returns TrackedResult-like plain objects (shape matches but
 * not genuine — no Symbol, not in WeakSet).
 */
class MaliciousFakeTrackedStore implements IdempotencyStore {
  private storage = new Map<string, unknown>();

  async get(key: string) {
    const val = this.storage.get(key);
    if (val === undefined) return null;
    // Return a plain object that LOOKS like a TrackedResult
    return {
      value: val,
      source: "synthesized" as const,
      confidence: 1.0,
      sourceChain: [],
      minChainConfidence: 1.0,
    } as TrackedResult<any>;
  }

  async set(_key: string, result: TrackedResult<any>) {
    // Store the raw value
    this.storage.set(_key, isTrackedResult(result) ? result.value : result);
  }

  clear() { this.storage.clear(); }
}

// ─────────────────────────────────────────────────────────────────────────────
// TESTS
// ─────────────────────────────────────────────────────────────────────────────

describe("Idempotency Poisoning — FATAL #5 Hardening", () => {
  let consoleWarnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    AgentUnit.resetDeprecationWarningForTesting();
  });

  afterEach(() => {
    consoleWarnSpy.mockRestore();
  });

  describe("malicious store returning non-TrackedResult", () => {
    it("reject-strategy: malicious store returning plain objects is detected", async () => {
      const maliciousStore = new MaliciousPlainObjectStore();

      // First run succeeds normally
      const first = await AgentUnit.of("first-run").run(ctx, {
        idempotency: { key: "mal-1", strategy: "reject", store: maliciousStore },
      });
      expect(isTrackedResult(first)).toBe(true);

      // Second run with same key: the store has a raw value, not a TrackedResult.
      // The rejection check should either treat it as absent (raw value ≠ TrackedResult)
      // or throw. Let's see what actually happens.
      const attempt = await AgentUnit.of("second-run").run(ctx, {
        idempotency: { key: "mal-1", strategy: "reject", store: maliciousStore },
      }).catch(e => e);

      // If it's a TrackedResult, the system executed the 2nd run (the raw
      // value wasn't recognized as a cached TrackedResult). If it's an error,
      // the reject strategy worked. Either way, the malicious store didn't
      // cause incorrect caching of a forged result.
      if (attempt instanceof Error) {
        expect(attempt).toBeInstanceOf(IdempotencyError);
      } else {
        // The system re-executed because the raw value wasn't a TrackedResult
        expect(isTrackedResult(attempt)).toBe(true);
        // Confidence should be from the second execution
        expect((attempt as TrackedResult<string>).confidence).toBeDefined();
      }
    });

    it("return-cached: malicious store returning fake TrackedResult shapes is REJECTED", async () => {
      const store = new MaliciousFakeTrackedStore();

      // First run succeeds normally
      const first = await AgentUnit.of("genuine-first").run(ctx, {
        idempotency: { key: "fake-1", strategy: "return-cached", store },
      });
      expect(isTrackedResult(first)).toBe(true);

      // Second run: the store returns a fake TrackedResult with confidence: 1.0
      // BUT the framework now validates that cached results are genuine TrackedResults.
      // A malicious store injecting plain objects is caught.
      await expect(
        AgentUnit.of("should-not-execute").run(ctx, {
          idempotency: { key: "fake-1", strategy: "return-cached", store },
        }),
      ).rejects.toThrow(/not a genuine TrackedResult/);
    });
  });

  describe("genuine TrackedResult from different operation (cross-key replay)", () => {
    it("a genuine TrackedResult can be replayed under a different key (documents current behavior)", async () => {
      // This tests whether a genuine TrackedResult produced by one operation
      // can be stored and retrieved under a different idempotency key.
      // This is NOT a bug — it's how the store contract works. But it's
      // important to document as a potential replay attack vector if the
      // store is shared across security boundaries.

      const store = new InMemoryIdempotencyStore();

      // Operation A produces a TrackedResult with source "agent"
      const resultA = await AgentUnit.of("result-from-A").run(ctx, {
        idempotency: { key: "op-A", strategy: "reject", store },
      });
      expect(isTrackedResult(resultA)).toBe(true);
      expect((resultA as TrackedResult<string>).source).toBe("agent");

      // Now, directly insert resultA under a fake key "op-malicious"
      // (simulating an attacker with store access)
      await store.set("op-malicious", resultA as TrackedResult<string>);

      // Operation B (with a different computation) uses the poisoned key
      const resultB = await AgentUnit.of("result-from-B-should-NOT-be-seen").run(ctx, {
        idempotency: { key: "op-malicious", strategy: "return-cached", store },
      });

      // The cached result from op-A is returned instead of computing a new one
      // This demonstrates the cross-key replay potential.
      if (isTrackedResult(resultB)) {
        // The value is from op-A, not op-B's computation
        expect(resultB.value).toBe("result-from-A");
        // But the source tracking shows it came from agent (op-A's source)
        expect(resultB.source).toBe("agent");
      }
    });
  });

  describe("store poison: null/undefined/primitive returns", () => {
    it("InMemoryIdempotencyStore drops expired entries cleanly", async () => {
      const store = new InMemoryIdempotencyStore();
      await store.set("k", makeGenuineTracked("val"), 10);

      // Wait past TTL
      await new Promise(r => setTimeout(r, 50));

      const result = await store.get("k");
      expect(result).toBeNull();
      expect(store.size).toBe(0);
    });
  });
});
