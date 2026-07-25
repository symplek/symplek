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
});
