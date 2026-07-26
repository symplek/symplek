/**
 * @module __tests__/idempotency
 * @description Tests for idempotency-key propagation in AgentUnit.run() and the
 *   InMemoryIdempotencyStore — duplicate rejection, cache return, TTL expiry,
 *   no-config pass-through, and the store get/set contract.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AgentUnit,
  createContext,
  IdempotencyError,
  IdempotencyStoreWriteError,
  InMemoryIdempotencyStore,
  isTracked,
} from "../index";
import type { IdempotencyStore } from "../idempotency";
import type { AgentContext } from "../types";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("idempotency", () => {
  const ctx: AgentContext = createContext();

  let consoleWarnSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    AgentUnit.resetDeprecationWarningForTesting();
  });
  afterEach(() => {
    consoleWarnSpy.mockRestore();
  });

  describe("AgentUnit.run() idempotency config", () => {
    it("rejects a duplicate key when strategy is 'reject'", async () => {
      const store = new InMemoryIdempotencyStore();
      const compute = vi.fn(async () => "result");
      const unit = () => AgentUnit.from(compute);

      const first = await unit().run(ctx, {
        idempotency: { key: "op-1", strategy: "reject", store },
      });
      expect(isTracked(first)).toBe(true);
      expect(compute).toHaveBeenCalledTimes(1);

      // Second run with the same key must throw and NOT execute again.
      await expect(
        unit().run(ctx, {
          idempotency: { key: "op-1", strategy: "reject", store },
        }),
      ).rejects.toBeInstanceOf(IdempotencyError);
      expect(compute).toHaveBeenCalledTimes(1);
    });

    it("surfaces IDEMPOTENCY_VIOLATION code + key on the error", async () => {
      const store = new InMemoryIdempotencyStore();
      await AgentUnit.of("x").run(ctx, {
        idempotency: { key: "dup", strategy: "reject", store },
      });

      const err = await AgentUnit.of("x")
        .run(ctx, { idempotency: { key: "dup", strategy: "reject", store } })
        .catch((e) => e);

      expect(err).toBeInstanceOf(IdempotencyError);
      expect(err.code).toBe("IDEMPOTENCY_VIOLATION");
      expect(err.key).toBe("dup");
    });

    it("returns the cached result when strategy is 'return-cached'", async () => {
      const store = new InMemoryIdempotencyStore();
      // Each run produces a distinct value; the cache must win on the 2nd call.
      let counter = 0;
      const compute = vi.fn(async () => `value-${++counter}`);

      const first = await AgentUnit.from(compute).run(ctx, {
        idempotency: { key: "op-2", strategy: "return-cached", store },
      });
      const second = await AgentUnit.from(compute).run(ctx, {
        idempotency: { key: "op-2", strategy: "return-cached", store },
      });

      expect(compute).toHaveBeenCalledTimes(1);
      expect(isTracked(first) && first.value).toBe("value-1");
      // Identical cached result returned, not a freshly computed "value-2".
      expect(isTracked(second) && second.value).toBe("value-1");
      expect(second).toEqual(first);
    });

    it("does not return a cached result once the TTL has expired", async () => {
      const store = new InMemoryIdempotencyStore();
      let counter = 0;
      const compute = vi.fn(async () => `value-${++counter}`);

      const first = await AgentUnit.from(compute).run(ctx, {
        idempotency: { key: "op-3", strategy: "return-cached", ttl: 25, store },
      });
      expect(isTracked(first) && first.value).toBe("value-1");

      // Wait past the TTL — the entry must be gone and the unit re-executes.
      await sleep(60);

      const second = await AgentUnit.from(compute).run(ctx, {
        idempotency: { key: "op-3", strategy: "return-cached", ttl: 25, store },
      });
      expect(compute).toHaveBeenCalledTimes(2);
      expect(isTracked(second) && second.value).toBe("value-2");
    });

    it("propagates the idempotency key into the AgentContext for tool calls", async () => {
      const store = new InMemoryIdempotencyStore();
      let seenKey: string | undefined;
      const unit = AgentUnit.from(async (c) => {
        seenKey = c.idempotencyKey;
        return "ok";
      });

      await unit.run(ctx, {
        idempotency: { key: "ctx-key", strategy: "reject", store },
      });
      expect(seenKey).toBe("ctx-key");
    });

    it("B3 — concurrent runs on the same key execute the computation exactly once", async () => {
      // Two concurrent run() calls with the same key must not both execute the
      // computation. The second call should await the first run's in-flight
      // promise and return the same result without a second execution.
      const store = new InMemoryIdempotencyStore();
      let executions = 0;
      const unit = AgentUnit.from(async () => {
        executions++;
        // Simulate async work so the second call actually races the first.
        await sleep(10);
        return `exec-${executions}`;
      });

      const [r1, r2] = await Promise.all([
        unit.run(ctx, { idempotency: { key: "concurrent-key", strategy: "return-cached", store } }),
        unit.run(ctx, { idempotency: { key: "concurrent-key", strategy: "return-cached", store } }),
      ]);

      // Computation must have run exactly once.
      expect(executions).toBe(1);
      // Both callers must receive the same result value.
      expect(isTracked(r1) && r1.value).toBe("exec-1");
      expect(isTracked(r2) && r2.value).toBe("exec-1");
    });

    it("B3 — store-write failure after successful computation surfaces IdempotencyStoreWriteError", async () => {
      // When the store write fails after the computation succeeds, the caller
      // must NOT receive a generic error that looks like a computation failure.
      // Instead IdempotencyStoreWriteError is thrown so the caller knows:
      // the side effect ran, do NOT retry as if it failed.
      const failingStore: IdempotencyStore = {
        async get() { return null; },
        async set() { throw new Error("Redis is down"); },
      };

      let executed = false;
      const unit = AgentUnit.from(async () => {
        executed = true;
        return "side-effect-ran";
      });

      const err = await unit
        .run(ctx, { idempotency: { key: "write-fail-key", strategy: "return-cached", store: failingStore } })
        .catch((e) => e);

      expect(executed).toBe(true); // computation ran
      expect(err).toBeInstanceOf(IdempotencyStoreWriteError);
      expect(err.message).toContain("Redis is down");
    });

    it("does not interfere with execution when no idempotency config is given", async () => {
      const compute = vi.fn(async () => "plain");

      const a = await AgentUnit.from(compute).run(ctx);
      const b = await AgentUnit.from(compute).run(ctx);

      // No config → every run executes; the context carries no key.
      expect(compute).toHaveBeenCalledTimes(2);
      expect(isTracked(a) && a.value).toBe("plain");
      expect(isTracked(b) && b.value).toBe("plain");
    });

    it("legacy trustMode still returns the raw cached value on a hit", async () => {
      const store = new InMemoryIdempotencyStore();
      await AgentUnit.of("legacy-val").run(ctx, {
        idempotency: { key: "op-legacy", strategy: "return-cached", store },
      });

      const cached = await AgentUnit.of("ignored").run(ctx, {
        trustMode: "legacy",
        idempotency: { key: "op-legacy", strategy: "return-cached", store },
      });
      expect(cached).toBe("legacy-val");
    });
  });

  describe("InMemoryIdempotencyStore", () => {
    const tracked = (value: unknown) =>
      ({ value }) as unknown as Parameters<
        InMemoryIdempotencyStore["set"]
      >[1];

    it("get() returns null for an unknown key", async () => {
      const store = new InMemoryIdempotencyStore();
      expect(await store.get("missing")).toBeNull();
    });

    it("set() then get() round-trips the stored result", async () => {
      const store = new InMemoryIdempotencyStore();
      const result = tracked("stored");
      await store.set("k", result);
      expect(await store.get("k")).toBe(result);
      expect(store.size).toBe(1);
    });

    it("get() returns null after the TTL elapses", async () => {
      const store = new InMemoryIdempotencyStore();
      await store.set("k", tracked("temp"), 20);
      expect(await store.get("k")).not.toBeNull();
      await sleep(50);
      expect(await store.get("k")).toBeNull();
    });

    it("delete() and clear() remove entries", async () => {
      const store = new InMemoryIdempotencyStore();
      await store.set("a", tracked(1));
      await store.set("b", tracked(2));
      store.delete("a");
      expect(await store.get("a")).toBeNull();
      expect(store.size).toBe(1);
      store.clear();
      expect(store.size).toBe(0);
    });
  });

  // ────────────────────────────────────────────────────────────────────────────
  // Race-condition regression tests (reviewer findings R1 + R2)
  // ────────────────────────────────────────────────────────────────────────────

  describe("race-condition hardening", () => {
    it("R1 — store-write failure does not allow a concurrent waiter to re-execute", async () => {
      // Scenario from the adversarial review:
      // A and B invoke key K concurrently. A executes the computation and its
      // store write fails. In the previous ordering, B's idemStore.get() could
      // complete AFTER A deleted the in-flight entry, causing B to re-execute.
      //
      // The fix: in-flight registration is synchronous, so B always sees A's
      // entry before A's first await. When A's store write fails, B is already
      // awaiting A's promise and receives the same IdempotencyStoreWriteError —
      // it does NOT launch a second execution.
      //
      // Interleaving forced by this test:
      //   1. A calls run() → in-flight registered synchronously → computation starts (async)
      //   2. B calls run() → sees A's in-flight entry → awaits it (no store read, no execution)
      //   3. A's store write fails → A's promise rejects with IdempotencyStoreWriteError
      //   4. B's await throws with the same error
      // Assertion: computation ran exactly once, not twice.
      let executions = 0;
      const unit = AgentUnit.from(async () => {
        executions++;
        await sleep(5); // ensure B starts awaiting before A finishes
        return `exec-${executions}`;
      });

      let _storeGetCalls = 0;
      const failingWriteStore: IdempotencyStore = {
        async get() {
          _storeGetCalls++;
          return null; // no cached value
        },
        async set() {
          throw new Error("store write failed");
        },
      };

      // Both callers run concurrently with the same key
      const [errA, errB] = await Promise.all([
        unit
          .run(ctx, { idempotency: { key: "race-k", strategy: "return-cached", store: failingWriteStore } })
          .catch((e) => e),
        unit
          .run(ctx, { idempotency: { key: "race-k", strategy: "return-cached", store: failingWriteStore } })
          .catch((e) => e),
      ]);

      // Computation ran exactly once — B shared A's in-flight promise
      expect(executions).toBe(1);

      // Both callers received an IdempotencyStoreWriteError (not a generic error or re-execution)
      expect(errA).toBeInstanceOf(IdempotencyStoreWriteError);
      expect(errB).toBeInstanceOf(IdempotencyStoreWriteError);
    });

    it("R2 — operation-mismatch: different AgentUnit instances do not share in-flight results", async () => {
      // Scenario: operation A (returns string) and operation B (returns number)
      // both use the same store and logical key concurrently.
      // With the previous flight key (store+key only), B could receive A's
      // TrackedResult<string> typed as TrackedResult<number>.
      // The fix includes the AgentUnit's ID in the flight key, so A and B
      // maintain independent in-flight entries.
      let aExecutions = 0;
      let bExecutions = 0;

      const unitA = AgentUnit.from(async () => {
        aExecutions++;
        await sleep(10);
        return "string-result";
      });

      const unitB = AgentUnit.from(async () => {
        bExecutions++;
        await sleep(10);
        return 42;
      });

      const store = new InMemoryIdempotencyStore();

      // Run both with the same key, concurrently
      const [rA, rB] = await Promise.all([
        unitA.run(ctx, { idempotency: { key: "shared-key", strategy: "return-cached", store } }),
        unitB.run(ctx, { idempotency: { key: "shared-key", strategy: "return-cached", store } }),
      ]);

      // Each operation ran independently — no result sharing across different units
      expect(aExecutions).toBe(1);
      expect(bExecutions).toBe(1);

      // Each result is the correct type for its operation
      expect(isTracked(rA) && rA.value).toBe("string-result");
      expect(isTracked(rB) && rB.value).toBe(42);
    });
  });
});
