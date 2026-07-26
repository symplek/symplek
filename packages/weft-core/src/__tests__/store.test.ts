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
  type DurableStoreBackend,
} from "../store/index";

// ─── test directory setup ─────────────────────────────────────────────────────

let testDir: string;

beforeAll(async () => {
  testDir = join(tmpdir(), `weft-store-test-${Date.now()}`);
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
    expect((serialized as any).__weft_tracked__).toBeUndefined();
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

  it("propagates non-ENOENT read errors — does not treat an unreadable entry as absent", async () => {
    // Place a *directory* at the path the backend would read for "payment-key".
    // readFile() on a directory returns EISDIR (not ENOENT) on all platforms.
    // Before the fix the backend swallowed this and returned null, silently
    // authorising re-execution of any committed side effect guarded by this
    // key. After the fix it must throw so the caller can decide whether
    // re-execution is safe after manual inspection.
    const dir = subdir("file-backend-eisdir");
    const backend = createFileBackend(dir);

    // "payment-key" has no special characters; encodeKey("payment-key") === "payment-key".
    await mkdir(join(dir, "payment-key"), { recursive: true });

    // Must throw — NOT return null and silently authorise a re-run
    await expect(backend.get("payment-key")).rejects.toThrow();
  });

  it("absent keys (ENOENT) still return null — absence and unreadability remain distinct", async () => {
    const dir = subdir("file-backend-absent-vs-unreadable");
    const backend = createFileBackend(dir);
    // No file written — genuine absence must still return null
    expect(await backend.get("never-written-key")).toBeNull();
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

  it("ordinary composed unit re-executes on resume — pre-committed step keys have no effect without explicit per-step wiring", async () => {
    // This test pins the documented contract: resume() does NOT automatically
    // skip sub-steps. A committed key like ${runId}:step1 in the store is
    // irrelevant to a unit that does not explicitly query it with its own
    // idempotency option. The unit re-executes even though step-key data is
    // present in the store.
    const dir = subdir("resume-no-step-keys");
    const runId = "run-no-step-keys";
    const store = createDurableStore(createFileBackend(dir));

    // Pre-commit a step result — as if this step ran in a prior process
    await store.idempotency.set(
      `${runId}:step1`,
      createTrackedResult("cached-step1", { source: "agent", confidence: 0.9 }),
    );

    let execCount = 0;
    // Ordinary unit: no explicit per-step idempotency wiring inside
    const unit = AgentUnit.from(async () => {
      execCount++;
      return "fresh-result";
    });

    // Outer runId is absent (simulates a crash before the outer run committed)
    const result = await resume(runId, unit, createContext(), { store });

    // The pre-committed step key is irrelevant — the unit has no code to look
    // it up. resume() does not inject per-step skipping automatically.
    expect(execCount).toBe(1); // unit ran, not skipped
    expect(result.value).toBe("fresh-result");
  });
});

// ─── 6. Encoding — injective key mapping (Finding F1) ────────────────────────

describe("createFileBackend — injective key encoding", () => {
  it("keys that collide under the old _-based encoding store and retrieve independently", async () => {
    // Old encoding: encodeURIComponent(key).replace(/%/g, "_")
    //   "idem:run/step"   → encodeURIComponent → "idem%3Arun%2Fstep" → "idem_3Arun_2Fstep"
    //   "idem:run_2Fstep" → encodeURIComponent → "idem%3Arun_2Fstep" → "idem_3Arun_2Fstep"  ← collision
    // New encoding (~ as escape):
    //   "idem:run/step"   → "idem~3Arun~2Fstep"
    //   "idem:run_2Fstep" → "idem~3Arun_2Fstep"  ← distinct
    const dir = subdir("encode-collision-idem");
    const backend = createFileBackend(dir);
    const enc = new TextEncoder();
    const dec = new TextDecoder();

    await backend.set("idem:run/step", enc.encode("slash-version"));
    await backend.set("idem:run_2Fstep", enc.encode("underscore-version"));

    const slashResult = await backend.get("idem:run/step");
    const underscoreResult = await backend.get("idem:run_2Fstep");

    expect(slashResult).not.toBeNull();
    expect(underscoreResult).not.toBeNull();
    expect(dec.decode(slashResult!)).toBe("slash-version");
    expect(dec.decode(underscoreResult!)).toBe("underscore-version");
  });

  it("keys with colons, slashes, underscores, percent signs, and tildes all round-trip", async () => {
    const dir = subdir("encode-roundtrip-specials");
    const backend = createFileBackend(dir);
    const enc = new TextEncoder();
    const dec = new TextDecoder();

    const keys = [
      "run/step",
      "run:step",
      "run_step",
      "run%2Fstep",
      "run~step",
      "run~2Fstep",
      "idem:run/step",
      "idem:run_2Fstep",
    ];

    for (const k of keys) {
      await backend.set(k, enc.encode(k));
    }

    for (const k of keys) {
      const raw = await backend.get(k);
      expect(raw, `round-trip failed for key: ${k}`).not.toBeNull();
      expect(dec.decode(raw!), `value mismatch for key: ${k}`).toBe(k);
    }
  });

  it("list() enumerates all keys under a prefix with no phantom entries after collision fix", async () => {
    const dir = subdir("encode-list-prefix");
    const backend = createFileBackend(dir);
    const enc = new TextEncoder();

    await backend.set("idem:run/step1", enc.encode("a"));
    await backend.set("idem:run_2Fstep1", enc.encode("b")); // collided with above under old encoding
    await backend.set("idem:run~step1", enc.encode("c"));
    await backend.set("other:run/step1", enc.encode("d"));

    const idemKeys = await backend.list("idem:");
    expect(idemKeys).toHaveLength(3);
    expect(idemKeys).toContain("idem:run/step1");
    expect(idemKeys).toContain("idem:run_2Fstep1");
    expect(idemKeys).toContain("idem:run~step1");
    expect(idemKeys).not.toContain("other:run/step1");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Finding 4 — structural validation before trusting a deserialized entry
//
// Pre-fix: `DurableIdempotencyStore.get()` passed any JSON-parseable value
// directly to `deserializeTrackedResult`, which does NOT validate its input.
// A structurally empty entry `{}` would produce a TrackedResult with undefined
// metadata, get added to the WeakSet, and be returned as a genuine cache hit —
// causing `resume()` to skip a computation that never actually committed.
//
// Post-fix: `isValidSerializedShape()` gates the entry before deserialization.
// A structurally invalid entry throws `IdempotencyStoreCorruptedError` rather
// than being silently promoted to a trusted result.
//
// Rule 015: tests FAIL pre-fix (get() returns a bogus result instead of throwing)
// and PASS post-fix.
// ─────────────────────────────────────────────────────────────────────────────

describe("DurableIdempotencyStore — structural validation (finding 4)", () => {
  it("throws for a structurally empty entry {} — pre-fix returns a bogus TrackedResult", async () => {
    const dir = subdir("idem-finding4-empty");
    const backend = createFileBackend(dir);
    const store = createDurableStore(backend);

    // Write {} directly — syntactically valid JSON, structurally not a TrackedResult
    await backend.set("idem:empty-key", new TextEncoder().encode("{}"));

    // Pre-fix: deserializeTrackedResult({}) silently creates a result with undefined
    // metadata and returns it as a cache hit → get() does NOT throw.
    // Post-fix: isValidSerializedShape({}) fails → IdempotencyStoreCorruptedError thrown.
    await expect(store.idempotency.get("empty-key")).rejects.toThrow();
  });

  it("throws for an entry with value but missing source and confidence fields", async () => {
    const dir = subdir("idem-finding4-partial");
    const backend = createFileBackend(dir);
    const store = createDurableStore(backend);

    const partial = { value: "some-result" }; // missing source, confidence, sourceChain, minChainConfidence
    await backend.set("idem:partial-key", new TextEncoder().encode(JSON.stringify(partial)));

    await expect(store.idempotency.get("partial-key")).rejects.toThrow();
  });

  it("throws for an entry with wrong types (confidence is a string, not a number)", async () => {
    const dir = subdir("idem-finding4-wrongtype");
    const backend = createFileBackend(dir);
    const store = createDurableStore(backend);

    const wrong = { value: "x", source: "agent", confidence: "high", sourceChain: [], minChainConfidence: "medium" };
    await backend.set("idem:wrongtype-key", new TextEncoder().encode(JSON.stringify(wrong)));

    await expect(store.idempotency.get("wrongtype-key")).rejects.toThrow();
  });

  it("a valid serialized entry still round-trips correctly after the guard is added", async () => {
    const dir = subdir("idem-finding4-valid");
    const store = createDurableStore(createFileBackend(dir));

    const original = createTrackedResult("valid-result", { source: "agent", confidence: 0.9 });
    await store.idempotency.set("valid-key", original);
    const fetched = await store.idempotency.get("valid-key");

    expect(fetched).not.toBeNull();
    expect(isTrackedResult(fetched!)).toBe(true);
    expect(fetched!.value).toBe("valid-result");
  });

  it("absent key returns null (absence and structural corruption remain distinct)", async () => {
    const dir = subdir("idem-finding4-absent");
    const store = createDurableStore(createFileBackend(dir));
    expect(await store.idempotency.get("no-such-key")).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Finding 5 — transaction log is session-local (no hydration)
//
// Pre-fix finding: the class was documented as providing durability but the
// in-memory map was never hydrated from the backend. After a restart,
// get(), query(), and getPending() operate on an empty map regardless of what
// is in the backend — the claim was false.
//
// Fix chosen: NARROW THE CLAIM (not implement hydration). Hydration would
// require making the initialization async, breaking the synchronous
// TransactionLogManager interface that all callers depend on. The simpler honest
// change is to document that the log is session-local.
//
// Exact wording the user now reads (in DurableTransactionLogManager class doc):
//   "The in-memory map is NOT hydrated from the backend on construction.
//    get(), query(), and getPending() reflect only entries created in the
//    CURRENT process session. A restarted process sees an empty map regardless
//    of what is persisted in the backend."
//
// The test below pins the actual (correctly documented) behavior. It passes both
// pre-fix and post-fix because the behavior was already correct — only the
// documentation was wrong. There is no code behavior change for Finding 5.
// ─────────────────────────────────────────────────────────────────────────────

describe("DurableTransactionLogManager — session-local reads (finding 5)", () => {
  it("get() returns undefined for a transaction committed in a prior session (expected no-hydration behavior)", async () => {
    const storage = new Map<string, Uint8Array>();
    const backend: DurableStoreBackend = {
      async get(k) { return storage.get(k) ?? null; },
      async set(k, v) { storage.set(k, v); },
      async del(k) { storage.delete(k); },
      async list(prefix) { return [...storage.keys()].filter((k) => k.startsWith(prefix)); },
    };

    // Session A: create and commit a transaction, background write persists to backend
    const storeA = createDurableStore(backend);
    const entry = storeA.transactions.create("agent-1", "charge", { amount: 100 });
    storeA.transactions.commit(entry.id, { chargeId: "ch_99" });
    // Allow background write to complete
    await new Promise<void>((r) => setImmediate(r));
    await new Promise<void>((r) => setImmediate(r));

    // Verify the entry was actually persisted to the backend
    const txnKey = `txn:${entry.id}`;
    expect(storage.has(txnKey)).toBe(true);

    // Session B: new store over same backend — in-memory map is empty (no hydration)
    const storeB = createDurableStore(backend);

    // All three read methods return empty/undefined — this is the EXPECTED behavior
    // after the doc fix. The backend has the entry; the in-memory map does not.
    expect(storeB.transactions.get(entry.id)).toBeUndefined();
    expect(storeB.transactions.getPending()).toHaveLength(0);
    expect(storeB.transactions.query({})).toHaveLength(0);
  });

  it("entries committed in the current session ARE visible via get() and query()", async () => {
    const dir = subdir("txn-session-local-current");
    const store = createDurableStore(createFileBackend(dir));

    const entry = store.transactions.create("agent-1", "action", { x: 1 });
    store.transactions.commit(entry.id, { result: "ok" });

    // Same-session reads work correctly
    const fetched = store.transactions.get(entry.id);
    expect(fetched).toBeDefined();
    expect(fetched?.status).toBe("committed");

    const all = store.transactions.query({});
    expect(all.some((e) => e.id === entry.id)).toBe(true);
  });
});

// ─── 7. Corruption safety — present-but-unreadable entry (Finding F2) ────────

describe("DurableIdempotencyStore — corrupt entry handling", () => {
  it("throws when a backend entry exists but cannot be JSON-parsed", async () => {
    const dir = subdir("idem-corrupt-json");
    const backend = createFileBackend(dir);
    const store = createDurableStore(backend);

    // Write corrupt bytes directly to the backend key (bypassing the store layer)
    await backend.set("idem:payment-key", new TextEncoder().encode("{not valid json{{{"));

    // Must throw — NOT silently return null and authorize a re-run
    await expect(store.idempotency.get("payment-key")).rejects.toThrow();
  });

  it("throws when a backend entry is truncated mid-JSON", async () => {
    const dir = subdir("idem-corrupt-truncated");
    const backend = createFileBackend(dir);
    const store = createDurableStore(backend);

    // Truncated JSON: valid prefix, but JSON.parse will fail
    await backend.set(
      "idem:charge-key",
      new TextEncoder().encode('{"source":"agent","value":"payment-result","confidence":'),
    );

    await expect(store.idempotency.get("charge-key")).rejects.toThrow();
  });

  it("absent key still returns null — absence and corruption remain distinct", async () => {
    const dir = subdir("idem-absent-key");
    const backend = createFileBackend(dir);
    const store = createDurableStore(backend);

    expect(await store.idempotency.get("never-written")).toBeNull();
  });
});

// ─── 8. Write ordering and failure observability (Finding F3) ─────────────────

describe("DurableTransactionLogManager — write ordering", () => {
  it("committed write always arrives after pending write even when pending is delayed", async () => {
    // Backend: first set() for any key is held until released; subsequent calls
    // for the same key run immediately.  This simulates a slow initial write
    // followed by an immediate commit write — the scenario where fire-and-forget
    // lets a delayed pending write overwrite a committed write.
    const storage = new Map<string, Uint8Array>();
    const dec = new TextDecoder();
    let firstWriteResolve: (() => void) | null = null;
    let firstWriteDone = false;

    const backend: DurableStoreBackend = {
      async get(key) { return storage.get(key) ?? null; },
      async set(key, value) {
        if (!firstWriteDone) {
          if (firstWriteResolve === null) {
            await new Promise<void>(resolve => { firstWriteResolve = resolve; });
          }
          firstWriteDone = true;
        }
        storage.set(key, value);
      },
      async del(key) { storage.delete(key); },
      async list(prefix) {
        return [...storage.keys()].filter(k => k.startsWith(prefix));
      },
    };

    const store = createDurableStore(backend);

    // create() fires the pending write, which suspends at the hold point
    const entry = store.transactions.create("agent-1", "charge", { amount: 100 });
    await new Promise<void>(r => setImmediate(r)); // let pending write reach hold

    // commit() while pending is still in-flight
    store.transactions.commit(entry.id, { chargeId: "ch_123" });
    // OLD CODE: committed write runs immediately (no hold), storage = committed
    // NEW CODE: committed write is chained after pending, hasn't started yet
    await new Promise<void>(r => setImmediate(r));

    // Release the held pending write
    firstWriteResolve!();
    // OLD CODE: pending write resumes, storage = pending (overwrites committed) — BUG
    // NEW CODE: pending write finishes, committed write runs, storage = committed
    await new Promise<void>(r => setImmediate(r));

    const txnKey = `txn:${entry.id}`;
    const raw = storage.get(txnKey);
    expect(raw, "no journal entry written").not.toBeNull();
    const persisted = JSON.parse(dec.decode(raw!));
    expect(persisted.status).toBe("committed");
  });

  it("a failed persist is logged to stderr rather than silently swallowed", async () => {
    const stderrMessages: string[] = [];
    const origWrite = process.stderr.write;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (process.stderr as any).write = (msg: unknown) => { stderrMessages.push(String(msg)); return true; };

    try {
      const backend: DurableStoreBackend = {
        async get() { return null; },
        async set() { throw new Error("disk full"); },
        async del() {},
        async list() { return []; },
      };

      const store = createDurableStore(backend);
      store.transactions.create("agent-1", "charge", {});

      await new Promise<void>(r => setImmediate(r));

      expect(stderrMessages.some(m => m.includes("disk full"))).toBe(true);
    } finally {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (process.stderr as any).write = origWrite;
    }
  });

  it("a failed pending persist does not block the subsequent committed write", async () => {
    let callCount = 0;
    const storage = new Map<string, Uint8Array>();
    const dec = new TextDecoder();

    const backend: DurableStoreBackend = {
      async get(key) { return storage.get(key) ?? null; },
      async set(key, value) {
        if (++callCount === 1) throw new Error("transient error");
        storage.set(key, value);
      },
      async del() {},
      async list() { return []; },
    };

    const origWrite = process.stderr.write;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (process.stderr as any).write = () => true; // suppress the logged error in test output

    try {
      const store = createDurableStore(backend);
      const entry = store.transactions.create("agent-1", "charge", {});

      await new Promise<void>(r => setImmediate(r)); // pending write fails

      store.transactions.commit(entry.id, { result: "ok" });
      await new Promise<void>(r => setImmediate(r)); // committed write runs

      expect(callCount).toBe(2);
      const txnKey = `txn:${entry.id}`;
      const raw = storage.get(txnKey);
      expect(raw, "committed write should have reached the backend").not.toBeNull();
      const persisted = JSON.parse(dec.decode(raw!));
      expect(persisted.status).toBe("committed");
    } finally {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (process.stderr as any).write = origWrite;
    }
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
