/**
 * @fileoverview Tests for Distributed Lock Manager
 * @module @symplek/core/solo/__tests__/lock
 *
 * 📝 BUILD[STORY-03.02]: Lock manager tests
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  acquireLock,
  cleanupExpiredLocks,
  clearAllLocks,
  extendLock,
  getActiveLocks,
  getLockHolder,
  InMemoryLockManager,
  isLockHeld,
  releaseLock,
} from "../lock";

describe("Lock Manager", () => {
  beforeEach(() => {
    clearAllLocks();
  });

  afterEach(() => {
    clearAllLocks();
  });

  describe("acquireLock", () => {
    it("should acquire an unlocked resource", async () => {
      const result = await acquireLock("resource-1", "agent-1", 30000);

      expect(result.acquired).toBe(true);
      expect(result.lock).toBeDefined();
      expect(result.lock?.resourceId).toBe("resource-1");
      expect(result.lock?.agentId).toBe("agent-1");
    });

    it("should reject if resource is held by another agent", async () => {
      await acquireLock("resource-1", "agent-1", 30000);
      const result = await acquireLock("resource-1", "agent-2", 30000);

      expect(result.acquired).toBe(false);
      expect(result.reason).toBe("already_held");
      expect(result.heldBy).toBe("agent-1");
    });

    it("should allow same agent to extend lock", async () => {
      await acquireLock("resource-1", "agent-1", 30000);
      const result = await acquireLock("resource-1", "agent-1", 30000);

      expect(result.acquired).toBe(true);
    });

    it("should acquire expired lock", async () => {
      // Set up mock time
      vi.useFakeTimers();
      const now = Date.now();
      vi.setSystemTime(now);

      // Acquire with short timeout
      await acquireLock("resource-1", "agent-1", 100);

      // Advance time past expiration
      vi.setSystemTime(now + 200);

      // Another agent should be able to acquire
      const result = await acquireLock("resource-1", "agent-2", 30000);

      expect(result.acquired).toBe(true);
      expect(result.lock?.agentId).toBe("agent-2");

      vi.useRealTimers();
    });

    it("should set correct expiration time", async () => {
      const before = Date.now();
      const result = await acquireLock("resource-1", "agent-1", 30000);
      const after = Date.now();

      expect(result.lock?.expires).toBeGreaterThanOrEqual(before + 30000);
      expect(result.lock?.expires).toBeLessThanOrEqual(after + 30000);
    });
  });

  describe("releaseLock", () => {
    it("should release a held lock", async () => {
      await acquireLock("resource-1", "agent-1", 30000);
      const released = await releaseLock("resource-1", "agent-1");

      expect(released).toBe(true);
      expect(await isLockHeld("resource-1")).toBe(false);
    });

    it("should not release lock held by another agent", async () => {
      await acquireLock("resource-1", "agent-1", 30000);
      const released = await releaseLock("resource-1", "agent-2");

      expect(released).toBe(false);
      expect(await isLockHeld("resource-1")).toBe(true);
    });

    it("should return true for non-existent lock", async () => {
      const released = await releaseLock("nonexistent", "agent-1");
      expect(released).toBe(true);
    });
  });

  describe("isLockHeld", () => {
    it("should return true for held lock", async () => {
      await acquireLock("resource-1", "agent-1", 30000);
      expect(await isLockHeld("resource-1")).toBe(true);
    });

    it("should return false for released lock", async () => {
      await acquireLock("resource-1", "agent-1", 30000);
      await releaseLock("resource-1", "agent-1");
      expect(await isLockHeld("resource-1")).toBe(false);
    });

    it("should return false for expired lock", async () => {
      vi.useFakeTimers();
      const now = Date.now();
      vi.setSystemTime(now);

      await acquireLock("resource-1", "agent-1", 100);
      vi.setSystemTime(now + 200);

      expect(await isLockHeld("resource-1")).toBe(false);

      vi.useRealTimers();
    });

    it("should return false for never-acquired resource", async () => {
      expect(await isLockHeld("never-acquired")).toBe(false);
    });
  });

  describe("getLockHolder", () => {
    it("should return holder agent ID", async () => {
      await acquireLock("resource-1", "agent-1", 30000);
      expect(await getLockHolder("resource-1")).toBe("agent-1");
    });

    it("should return undefined for unlocked resource", async () => {
      expect(await getLockHolder("unlocked")).toBeUndefined();
    });
  });

  describe("extendLock", () => {
    it("should extend lock held by same agent", async () => {
      await acquireLock("resource-1", "agent-1", 30000);
      const extended = await extendLock("resource-1", "agent-1", 10000);

      expect(extended).toBe(true);
    });

    it("should not extend lock held by another agent", async () => {
      await acquireLock("resource-1", "agent-1", 30000);
      const extended = await extendLock("resource-1", "agent-2", 10000);

      expect(extended).toBe(false);
    });

    it("should not extend non-existent lock", async () => {
      const extended = await extendLock("nonexistent", "agent-1", 10000);
      expect(extended).toBe(false);
    });
  });

  describe("getActiveLocks", () => {
    it("should return all active locks", async () => {
      await acquireLock("resource-1", "agent-1", 30000);
      await acquireLock("resource-2", "agent-2", 30000);

      const active = getActiveLocks();

      expect(active).toHaveLength(2);
      expect(active.map((l) => l.resourceId).sort()).toEqual([
        "resource-1",
        "resource-2",
      ]);
    });

    it("should exclude expired locks", async () => {
      vi.useFakeTimers();
      const now = Date.now();
      vi.setSystemTime(now);

      await acquireLock("resource-1", "agent-1", 100);
      await acquireLock("resource-2", "agent-2", 30000);

      vi.setSystemTime(now + 200);

      const active = getActiveLocks();

      expect(active).toHaveLength(1);
      expect(active[0].resourceId).toBe("resource-2");

      vi.useRealTimers();
    });
  });

  describe("cleanupExpiredLocks", () => {
    it("should remove expired locks", async () => {
      vi.useFakeTimers();
      const now = Date.now();
      vi.setSystemTime(now);

      await acquireLock("resource-1", "agent-1", 100);
      await acquireLock("resource-2", "agent-2", 30000);

      vi.setSystemTime(now + 200);

      const cleaned = cleanupExpiredLocks();

      expect(cleaned).toBe(1);
      expect(await isLockHeld("resource-2")).toBe(true);

      vi.useRealTimers();
    });
  });

  describe("InMemoryLockManager class", () => {
    it("should implement LockManager interface", async () => {
      const manager = new InMemoryLockManager();

      const result = await manager.acquire("resource-1", "agent-1", 30000);
      expect(result.acquired).toBe(true);

      expect(await manager.isLocked("resource-1")).toBe(true);
      expect(await manager.getHolder("resource-1")).toBe("agent-1");

      expect(await manager.extend("resource-1", "agent-1", 10000)).toBe(true);
      expect(await manager.release("resource-1", "agent-1")).toBe(true);

      expect(await manager.isLocked("resource-1")).toBe(false);
    });

    it("should keep lock state isolated per manager instance", async () => {
      const managerA = new InMemoryLockManager();
      const managerB = new InMemoryLockManager();

      const first = await managerA.acquire("resource-1", "agent-1", 30000);
      const second = await managerB.acquire("resource-1", "agent-2", 30000);

      expect(first.acquired).toBe(true);
      expect(second.acquired).toBe(true);
      expect(await managerA.getHolder("resource-1")).toBe("agent-1");
      expect(await managerB.getHolder("resource-1")).toBe("agent-2");
    });
  });
});
