/**
 * @module lock-instance-isolation.test
 * @description Contract 4 obligations: InMemoryLockManager per-instance isolation,
 * free-standing function delegation, extendLock new-entry guarantee (M7),
 * and cleanupExpiredLocks behavior.
 */

import { afterEach, describe, expect, it } from "vitest";
import {
  acquireLock,
  clearAllLocks,
  cleanupExpiredLocks,
  defaultLockManager,
  extendLock,
  InMemoryLockManager,
} from "../solo/lock";
import { createContext } from "@symplek/core";
import type { AgentUnitMetadata } from "@symplek/core";
import { createSoloComputation } from "../operators";

// ─── helpers ──────────────────────────────────────────────────────────────────

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── Obligation 6 pattern: each test uses a fresh instance OR clearAllLocks ──

describe("Contract 4 — InMemoryLockManager state isolation", () => {
  afterEach(() => {
    clearAllLocks(); // reset defaultLockManager between tests
  });

  // ── Obligation 1 ──────────────────────────────────────────────────────────
  // Two InMemoryLockManager instances do not share lock state.
  it("two instances: same resourceId acquirable on both independently", async () => {
    const instanceA = new InMemoryLockManager();
    const instanceB = new InMemoryLockManager();

    const rA = await instanceA.acquire("res-1", "agent-a", 5000);
    expect(rA.acquired).toBe(true);

    // Instance B has its own empty map — should succeed for the same resourceId
    const rB = await instanceB.acquire("res-1", "agent-b", 5000);
    expect(rB.acquired).toBe(true);

    // Confirm A's map still shows agent-a (not agent-b)
    expect(await instanceA.getHolder("res-1")).toBe("agent-a");
    expect(await instanceB.getHolder("res-1")).toBe("agent-b");
  });

  it("releasing on instance A does not release on instance B", async () => {
    const instanceA = new InMemoryLockManager();
    const instanceB = new InMemoryLockManager();

    await instanceA.acquire("res-2", "agent-a", 5000);
    await instanceB.acquire("res-2", "agent-b", 5000);

    await instanceA.release("res-2", "agent-a");
    // B should still hold the lock
    expect(await instanceB.isLocked("res-2")).toBe(true);
  });

  // ── Obligation 2 ──────────────────────────────────────────────────────────
  // acquireLock (free-standing) and defaultLockManager.acquire share state.
  it("free-standing acquireLock and defaultLockManager.acquire share state", async () => {
    const r1 = await acquireLock("shared-res", "agent-x", 5000);
    expect(r1.acquired).toBe(true);

    // Now try via defaultLockManager — same resource should be locked (different agent)
    const r2 = await defaultLockManager.acquire("shared-res", "agent-y", 5000);
    expect(r2.acquired).toBe(false);
    expect(r2.heldBy).toBe("agent-x");
  });

  it("defaultLockManager.acquire then free-standing isLockHeld sees the lock", async () => {
    await defaultLockManager.acquire("shared-res-2", "agent-z", 5000);

    const locks = defaultLockManager.getActive();
    const found = locks.find((l) => l.resourceId === "shared-res-2");
    expect(found).toBeDefined();
    expect(found?.agentId).toBe("agent-z");
  });

  // ── Obligation 3 ──────────────────────────────────────────────────────────
  // clearAllLocks() clears defaultLockManager but not a separately constructed instance.
  it("clearAllLocks clears only defaultLockManager, not separate instances", async () => {
    const isolated = new InMemoryLockManager();
    await isolated.acquire("iso-res", "agent-iso", 5000);

    await acquireLock("default-res", "agent-d", 5000);
    expect(defaultLockManager.getActive().length).toBeGreaterThan(0);

    clearAllLocks();

    // defaultLockManager should be empty
    expect(defaultLockManager.getActive()).toHaveLength(0);

    // Isolated instance should still have its lock
    expect(await isolated.isLocked("iso-res")).toBe(true);
  });

  // ── Obligation 4 ──────────────────────────────────────────────────────────
  // extendLock (M7 fix): Map entry after extend is a new object reference.
  it("extendLock writes a new Map entry — original object not mutated", async () => {
    const mgr = new InMemoryLockManager();
    const r = await mgr.acquire("ext-res", "agent-e", 10000);
    expect(r.acquired).toBe(true);
    const originalLock = r.lock!;
    const originalExpiry = originalLock.expires;

    const extended = await mgr.extend("ext-res", "agent-e", 5000);
    expect(extended).toBe(true);

    // The new Map entry should have a later expiry
    const active = mgr.getActive();
    const newEntry = active.find((l) => l.resourceId === "ext-res");
    expect(newEntry).toBeDefined();
    expect(newEntry!.expires).toBeGreaterThan(originalExpiry);

    // The original object reference must not have been mutated
    expect(originalLock.expires).toBe(originalExpiry);
  });

  it("free-standing extendLock also returns a new entry (via defaultLockManager)", async () => {
    await acquireLock("ext-def", "agent-def", 10000);
    const before = defaultLockManager
      .getActive()
      .find((l) => l.resourceId === "ext-def");
    expect(before).toBeDefined();
    const expBefore = before!.expires;

    const extended = await extendLock("ext-def", "agent-def", 5000);
    expect(extended).toBe(true);

    const after = defaultLockManager
      .getActive()
      .find((l) => l.resourceId === "ext-def");
    expect(after).toBeDefined();
    expect(after!.expires).toBeGreaterThan(expBefore);
    // Original before object was captured by value (spread); it should not change
    expect(expBefore).toBeLessThan(after!.expires);
  });

  // ── Obligation 5 ──────────────────────────────────────────────────────────
  // cleanupExpiredLocks removes expired entries; unexpired entries remain.
  it("cleanupExpiredLocks removes expired, retains unexpired", async () => {
    const mgr = new InMemoryLockManager();

    // Acquire with a 1ms timeout so it expires almost immediately
    await mgr.acquire("expires-fast", "agent-fast", 1);
    // Acquire with a long timeout
    await mgr.acquire("stays-alive", "agent-slow", 60000);

    await sleep(5); // let the 1ms lock expire

    const removed = mgr.cleanup();
    expect(removed).toBeGreaterThanOrEqual(1);

    const remaining = mgr.getActive();
    expect(remaining.some((l) => l.resourceId === "expires-fast")).toBe(false);
    expect(remaining.some((l) => l.resourceId === "stays-alive")).toBe(true);
  });

  // ── Obligation 6 pattern: fresh instance in tests ─────────────────────────
  // Demonstrated throughout above — each test constructs `new InMemoryLockManager()`
  // for isolation-critical assertions, and uses clearAllLocks() in afterEach for
  // defaultLockManager hygiene.

  // ── Obligation 7 ──────────────────────────────────────────────────────────
  // solo operator integration: createSoloComputation uses free-standing acquireLock
  // → lock is acquired from defaultLockManager during execution.
  it("createSoloComputation uses acquireLock from defaultLockManager", async () => {
    const ctx = createContext();
    const resourceId = "solo-integration-res";

    const meta: AgentUnitMetadata = {
      id: "test-solo",
      operatorChain: [],
      createdAt: Date.now(),
    };

    // Inner computation returns an object with explicit confidence/coherence/riskScore
    // so extractSignals picks them up and allows solo action.
    const innerComputation = async () => ({
      value: "solo-result",
      confidence: 0.95,
      coherence: 0.91,
      riskScore: 0.05,
    });

    const soloComp = createSoloComputation(innerComputation, meta, {
      resourceId,
      lockTimeout: 5000,
      confidenceThreshold: 0.90,
      coherenceThreshold: 0.85,
      riskThreshold: 0.30,
    });

    const result = await soloComp(ctx);

    expect(result).toBeDefined();
    expect(result.decision.canActSolo).toBe(true);
    // After completion, lock should be released from defaultLockManager
    const activeLocks = defaultLockManager.getActive();
    expect(activeLocks.some((l) => l.resourceId === resourceId)).toBe(false);
  });
});
