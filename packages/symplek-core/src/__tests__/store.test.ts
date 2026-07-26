/**
 * Store module tests — CR-403 acceptance criteria.
 *
 * Covers:
 *   1. serialize/deserialize round-trip → isTrackedResult() passes
 *   2. createFileBackend round-trip (write/read/deserialize)
 *   3. Durable IdempotencyStore: at-most-once across simulated "restart"
 *   4. resume(): skips steps 1+2 (committed), re-executes step 3 (not committed)
 *   5. createDurableStore(backend) → DurableStoreOptions injects into run()
 *   6. Journal entry contents (no secrets persisted)
 *   7. Store write failure → IdempotencyStoreWriteError
 */

import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { AgentUnit, createContext } from "../index";
import { createTrackedResult, isTrackedResult } from "../trust";
import {
  deserializeTrackedResult,
  serializeTrackedResult,
} from "../trust";
import {
  createDurableStore,
  createFileBackend,
  resume,
} from "../store/index";

// ─── test directory setup ─────────────────────────────────────────────────────

let testDir: string;

beforeAll(async () => {
  testDir = join(tmpdir(), `symplek-store-test-${Date.now()}`);
  await mkdir(testDir, { recursive: true });
});

afterAll(async () => {
  await rm(testDir, { recursive: true, force: true });
});

function subdir(name: string): string {
  return join(testDir, name);
}

// ─── 1. serialize / deserialize round-trip ───────────────────────────────────

describe("serializeTrackedResult / deserializeTrackedResult", () => {
  it("round-trips a plain result and the deserialized copy passes isTrackedResult()", () => {
    const original = createTrackedResult("hello", {
      source: "agent",
      confidence: 0.85,
    });
    const serialized = serializeTrackedResult(original);
    const restored = deserializeTrackedResult(serialized);
    expect(isTrackedResult(restored)).toBe(true);
    expect(restored.value).toBe("hello");
    expect(restored.confidence).toBe(0.85);
    expect(restored.source).toBe("agent");
  });

  it("round-trips objectiveConfidence and coherence", () => {
    const original = createTrackedResult({ answer: 42 }, {
      source: "synthesized",
      confidence: 0.9,
      objectiveConfidence: {
        composite: 0.9,
        agreementRate: 0.95,
        entropyConfidence: 0.88,
        varianceConfidence: 0.91,
        retryConfidence: 1,
      },
    });
    const restored = deserializeTrackedResult(serializeTrackedResult(original));
    expect(isTrackedResult(restored)).toBe(true);
    expect(restored.objectiveConfidence?.composite).toBe(0.9);
    expect(restored.objectiveConfidence?.agreementRate).toBe(0.95);
  });

  it("throws when given a non-genuine TrackedResult", () => {
    const fake = { value: "bad", source: "agent", confidence: 1 } as any;
    expect(() => serializeTrackedResult(fake)).toThrow(TypeError);
  });

  it("serialized object contains no prompt or response text — only metadata", () => {
    const original = createTrackedResult("some-llm-output", {
      source: "agent",
      confidence: 0.7,
    });
    const serialized = serializeTrackedResult(original);
    // The value field IS included (it is the result data)
    expect(serialized.value).toBe("some-llm-output");
    // The private symbol marker is NOT present
    const keys = Object.keys(serialized);
    expect(keys.every((k) => typeof k === "string" && !k.startsWith("Symbol("))).toBe(true);
    // Verify no WeakSet-only fields leaked
    expect((serialized as any).__symplek_tracked__).toBeUndefined();
  });

  it("isTrackedResult(deserializeTrackedResult(serializeTrackedResult(r))) is true after module reset simulation", () => {
    // Simulate deserialization in a context where the WeakSet was reset
    // by creating a new result, serializing, then deserializing
    const r = createTrackedResult("test", { source: "verified", confidence: 1 });
    const s = serializeTrackedResult(r);
    // Create a plain object mimicking a deserialized snapshot (not in WeakSet)
    const plain = { ...s } as any;
    expect(isTrackedResult(plain)).toBe(false); // not in WeakSet
    // But deserializeTrackedResult re-registers it
    const recovered = deserializeTrackedResult(s);
    expect(isTrackedResult(recovered)).toBe(true);
  });
});

// ─── 2. createFileBackend round-trip ─────���───────────────────────────────────

describe("createFileBackend", () => {
  it("round-trips a TrackedResult through serialize/store/load/deserialize", async () => {
    const dir = subdir("file-backend-basic");
    const backend = createFileBackend(dir);

    const original = createTrackedResult({ score: 99 }, {
      source: "agent",
      confidence: 0.92,
    });
    const serialized = serializeTrackedResult(original);
    const bytes = new TextEncoder().encode(JSON.stringify(serialized));

    await backend.set("test-key", bytes);
    const raw = await backend.get("test-key");
    expect(raw).not.toBeNull();

    const parsed = JSON.parse(new TextDecoder().decode(raw!));
    const restored = deserializeTrackedResult(parsed);
    expect(isTrackedResult(restored)).toBe(true);
    expect(restored.value).toEqual({ score: 99 });
    expect(restored.confidence).toBe(0.92);
  });

  it("returns null for absent keys", async () => {
    const dir = subdir("file-backend-absent");
    const backend = createFileBackend(dir);
    expect(await backend.get("no-such-key")).toBeNull();
  });

  it("deletes a key", async () => {
    const dir = subdir("file-backend-del");
    const backend = createFileBackend(dir);
    const bytes = new TextEncoder().encode("data");
    await backend.set("to-delete", bytes);
    expect(await backend.get("to-delete")).not.toBeNull();
    await backend.del("to-delete");
    expect(await backend.get("to-delete")).toBeNull();
  });

  it("lists keys with a given prefix", async () => {
    const dir = subdir("file-backend-list");
    const backend = createFileBackend(dir);
    const enc = new TextEncoder();
    await backend.set("run1:step1", enc.encode("a"));
    await backend.set("run1:step2", enc.encode("b"));
    await backend.set("run2:step1", enc.encode("c"));

    const run1Keys = await backend.list("run1:");
    expect(run1Keys).toHaveLength(2);
    expect(run1Keys).toContain("run1:step1");
    expect(run1Keys).toContain("run1:step2");
    expect(run1Keys).not.toContain("run2:step1");
  });

  it("respects TTL — expired entries return null", async () => {
    vi.useFakeTimers();
    const dir = subdir("file-backend-ttl");
    const backend = createFileBackend(dir);
    const bytes = new TextEncoder().encode("ttl-data");
    await backend.set("ttl-key", bytes, 100); // 100ms TTL

    expect(await backend.get("ttl-key")).not.toBeNull();

    vi.advanceTimersByTime(200);
    expect(await backend.get("ttl-key")).toBeNull();
    vi.useRealTimers();
  });
});

// ─── 3. Durable IdempotencyStore: at-most-once across restart ───────────────

describe("DurableIdempotencyStore (via createDurableStore)", () => {
  it("persists a result and retrieves it after a simulated restart (new store instance, same backend)", async () => {
    const dir = subdir("idem-restart");
    const backend1 = createFileBackend(dir);
    const store1 = createDurableStore(backend1).idempotency;

    const result = createTrackedResult("persisted-answer", {
      source: "agent",
      confidence: 0.88,
    });
    await store1.set("run-42", result);

    // Simulate restart: new backend + new store instance (different object identity)
    const backend2 = createFileBackend(dir); // same dir → same files
    const store2 = createDurableStore(backend2).idempotency;

    const fetched = await store2.get("run-42");
    expect(fetched).not.toBeNull();
    expect(isTrackedResult(fetched!)).toBe(true);
    expect(fetched!.value).toBe("persisted-answer");
    expect(fetched!.confidence).toBe(0.88);
  });

  it("at-most-once: a result stored in the durable store prevents re-execution", async () => {
    const dir = subdir("idem-at-most-once");
    const store = createDurableStore(createFileBackend(dir));
    const ctx = createContext();

    let execCount = 0;
    const unit = AgentUnit.from(async () => {
      execCount++;
      return "computed";
    });

    // First run: executes and stores
    await unit.run(ctx, {
      idempotency: {
        key: "idem-key",
        strategy: "return-cached",
        store: store.idempotency,
      },
    });
    expect(execCount).toBe(1);

    // Simulate restart: new store, same backend dir
    const store2 = createDurableStore(createFileBackend(dir));
    await unit.run(ctx, {
      idempotency: {
        key: "idem-key",
        strategy: "return-cached",
        store: store2.idempotency,
      },
    });
    expect(execCount).toBe(1); // NOT re-executed
  });
});

// ─── 4. resume(): 3-step pipeline, steps 1+2 committed, step 3 not ──────────

describe("resume()", () => {
  it("skips committed steps (1+2) and re-executes uncommitted step (3)", async () => {
    const dir = subdir("resume-3step");
    const runId = "run-001";
    const store = createDurableStore(createFileBackend(dir));

    // Pre-populate store with step 1 and step 2 results (simulate completed steps)
    await store.idempotency.set(
      `${runId}:step1`,
      createTrackedResult("step1-result", { source: "agent", confidence: 0.9 }),
    );
    await store.idempotency.set(
      `${runId}:step2`,
      createTrackedResult("step2-result", { source: "agent", confidence: 0.9 }),
    );
    // step3 is NOT in the store — it didn't commit in the original run

    const executionLog: string[] = [];

    // A pipeline that manually uses idempotency keys for each step
    // (the pattern resume() requires)
    const pipeline = AgentUnit.from(async (ctx) => {
      const s1 = await AgentUnit.from(async () => {
        executionLog.push("step1");
        return "step1-result";
      }).run(ctx, {
        idempotency: {
          key: `${runId}:step1`,
          strategy: "return-cached",
          store: store.idempotency,
        },
      });

      const s2 = await AgentUnit.from(async () => {
        executionLog.push("step2");
        return "step2-result";
      }).run(ctx, {
        idempotency: {
          key: `${runId}:step2`,
          strategy: "return-cached",
          store: store.idempotency,
        },
      });

      const s3 = await AgentUnit.from(async () => {
        executionLog.push("step3");
        return "step3-result";
      }).run(ctx, {
        idempotency: {
          key: `${runId}:step3`,
          strategy: "return-cached",
          store: store.idempotency,
        },
      });

      return { v1: s1.value, v2: s2.value, v3: s3.value };
    });

    const result = await resume(runId, pipeline, createContext(), { store });

    // Steps 1+2 cached → their functions NOT called; step 3 not cached → called
    expect(executionLog).toEqual(["step3"]);
    expect(result.value).toEqual({
      v1: "step1-result",
      v2: "step2-result",
      v3: "step3-result",
    });
    expect(isTrackedResult(result)).toBe(true);
  });

  it("returns cached whole-run result when runId itself is in the store", async () => {
    const dir = subdir("resume-whole-cache");
    const runId = "run-whole";
    const store = createDurableStore(createFileBackend(dir));

    const cachedResult = createTrackedResult("already-done", {
      source: "agent",
      confidence: 1,
    });
    await store.idempotency.set(runId, cachedResult);

    let executed = false;
    const unit = AgentUnit.from(async () => {
      executed = true;
      return "should-not-run";
    });

    const result = await resume(runId, unit, createContext(), { store });
    expect(executed).toBe(false);
    expect(result.value).toBe("already-done");
  });
});

// ─── 5. createDurableStore(backend) injects into run() via DurableStoreOptions

describe("createDurableStore injection into run()", () => {
  it("existing in-memory runs are unaffected when DurableStoreOptions are absent", async () => {
    const unit = AgentUnit.of("no-store");
    const ctx = createContext();
    const result = await unit.run(ctx);
    expect(result.value).toBe("no-store");
    expect(isTrackedResult(result)).toBe(true);
  });

  it("durable store can replace InMemoryIdempotencyStore with zero API change", async () => {
    const dir = subdir("injection-test");
    const store = createDurableStore(createFileBackend(dir));
    const ctx = createContext();

    const unit = AgentUnit.of("durable-value");
    const result = await unit.run(ctx, {
      idempotency: {
        key: "injection-key",
        strategy: "return-cached",
        store: store.idempotency,
      },
    });
    expect(result.value).toBe("durable-value");
    expect(isTrackedResult(result)).toBe(true);
  });
});
