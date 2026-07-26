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

    it("R-strategy — return-cached waiter does not inherit reject leader's IdempotencyError", async () => {
      // Scenario: store already contains key K.
      // A "reject" leader starts an in-flight delayed lookup, then a concurrent
      // "return-cached" waiter joins its flight. The leader's executePromise finds
      // K in the store and throws IdempotencyError. Previously, the waiter received
      // that error unchanged. After the fix, the waiter applies its own strategy:
      // "return-cached" → fetches from the store and returns the cached value.
      const store = new InMemoryIdempotencyStore();

      // Pre-populate the store.
      const first = await AgentUnit.of("cached-value").run(ctx, {
        idempotency: { key: "K", strategy: "return-cached", store },
      });
      expect(isTracked(first) && first.value).toBe("cached-value");

      // Simulate: "reject" call starts; "return-cached" call joins its flight.
      // We use Promise.all so both calls are dispatched before either awaits.
      const rejectResult = AgentUnit.of("ignored").run(ctx, {
        idempotency: { key: "K", strategy: "reject", store },
      });
      const returnCachedResult = AgentUnit.of("ignored").run(ctx, {
        idempotency: { key: "K", strategy: "return-cached", store },
      });

      // "reject" must throw.
      await expect(rejectResult).rejects.toBeInstanceOf(IdempotencyError);

      // "return-cached" must return the cached value, NOT throw IdempotencyError.
      const cached = await returnCachedResult;
      expect(isTracked(cached) && cached.value).toBe("cached-value");
    });

    it("R3 — store.get() that re-enters unit.run() during get() does not execute computation twice", async () => {
      // Failure scenario (without deferred-promise fix):
      //   1. Outer run() starts IIFE → IIFE calls store.get(key) synchronously.
      //   2. store.get() fires a nested unit.run() for the same key (without awaiting).
      //   3. Nested run() checks _idempotencyInFlight → EMPTY (outer hasn't set it yet)
      //      → installs its own flight entry.
      //   4. IIFE returns from store.get() → outer sets _idempotencyInFlight, overwriting
      //      the nested entry.
      //   5. Both outer and nested run the computation → execCount = 2.
      //
      // With fix: flight entry registered BEFORE store.get() is called. Nested run()
      // finds the entry immediately and awaits the shared promise → execCount = 1.
      let execCount = 0;
      // Declare with definite-assignment assertion so the store closure can
      // reference it before the assignment below.
      let unit!: AgentUnit<string>;

      let getCallCount = 0;
      const reentrantStore: IdempotencyStore = {
        get: async (key: string) => {
          getCallCount++;
          if (getCallCount === 1) {
            // First call: fire a nested run WITHOUT awaiting to match the failure scenario.
            // The nested call either shares the outer flight (fix) or creates a duplicate (bug).
            unit
              .run(ctx, {
                idempotency: { key, strategy: "return-cached", store: reentrantStore },
              })
              .catch(() => {
                // Circular await resolves fine with the fix; ignore any error here.
              });
          }
          return null; // simulate cache miss
        },
        set: async () => {},
      };

      unit = AgentUnit.from(async () => {
        execCount++;
        return `exec-${execCount}`;
      });

      await unit.run(ctx, {
        idempotency: { key: "reentrant-k", strategy: "return-cached", store: reentrantStore },
      });

      // Computation must have executed exactly once.
      expect(execCount).toBe(1);
    });

    it("R2 — two separately constructed instances of the same operation execute the computation once", async () => {
      // The flight key is scoped to store+key (not unit instance), so at-most-once
      // is enforced at exactly the same boundary as persistence. Two independently
      // constructed units that share a store and key represent a single logical
      // operation — only one execution should occur.
      //
      // Assertion change from previous round: the prior R2 test checked that two
      // differently-typed units (string vs number) maintained *separate* in-flight
      // entries because their unit IDs differed. That behaviour was introduced by a
      // prior incorrect direction (including unit ID in the flight key). The correct
      // guarantee is: same store + same key → execute once. Two operation types
      // sharing a key is a developer misuse outside the at-most-once contract.
      let executions = 0;
      const computation = async () => {
        executions++;
        await sleep(10);
        return "shared-result";
      };

      // Two SEPARATELY constructed AgentUnit instances from the same computation.
      const unitA = AgentUnit.from(computation);
      const unitB = AgentUnit.from(computation);

      const store = new InMemoryIdempotencyStore();

      const [rA, rB] = await Promise.all([
        unitA.run(ctx, { idempotency: { key: "shared-key", strategy: "return-cached", store } }),
        unitB.run(ctx, { idempotency: { key: "shared-key", strategy: "return-cached", store } }),
      ]);

      // Computation ran exactly once despite two separate instances.
      expect(executions).toBe(1);

      // Both callers receive the same result.
      expect(isTracked(rA) && rA.value).toBe("shared-result");
      expect(isTracked(rB) && rB.value).toBe("shared-result");
    });
  });
});
