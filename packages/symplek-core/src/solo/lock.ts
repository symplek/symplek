/**
 * @fileoverview Distributed Lock Manager
 * @description In-memory lock implementation for solo mechanism
 * @module @symplek/core/solo/lock
 * @since 1.0.0-beta.1
 *
 * ?? BUILD[STORY-01.05]: Lock manager implementation
 *
 * @remarks
 * Implements a simple in-memory lock manager for MVP.
 * Inspired by Redlock algorithm but simplified for single-process use.
 * Can be replaced with Redis/Convex implementation for distributed scenarios.
 *
 * Thread safety: Uses synchronous operations on Map, safe for Node.js single-threaded model.
 * For multi-process scenarios, replace with distributed lock implementation.
 */

import type { LockAcquisitionResult, LockEntry, LockManager } from "./types";

// -----------------------------------------------------------------------------
// CORE LOCK FUNCTIONS
// -----------------------------------------------------------------------------

/**
 * Attempt to acquire a distributed lock on a resource.
 *
 * @param resourceId - Unique identifier for the resource to lock
 * @param agentId - Identifier of the agent requesting the lock
 * @param timeoutMs - How long the lock should be held (default: 30000ms)
 * @returns Lock acquisition result
 *
 * @example
 * ```typescript
 * const result = await acquireLock("task-123", "agent-1", 30000);
 * if (result.acquired) {
 *   try {
 *     // Do work while holding lock
 *   } finally {
 *     await releaseLock("task-123", "agent-1");
 *   }
 * }
 * ```
 */
export async function acquireLock(
  resourceId: string,
  agentId: string,
  timeoutMs: number = 30000,
): Promise<LockAcquisitionResult> {
  return defaultLockManager.acquire(resourceId, agentId, timeoutMs);
}

/**
 * Release a held lock.
 *
 * @param resourceId - Resource to unlock
 * @param agentId - Agent releasing the lock (must match holder)
 * @returns True if lock was released, false if not held by this agent
 */
export async function releaseLock(
  resourceId: string,
  agentId: string,
): Promise<boolean> {
  return defaultLockManager.release(resourceId, agentId);
}

/**
 * Check if a resource is currently locked.
 *
 * @param resourceId - Resource to check
 * @returns True if resource is locked and lock hasn't expired
 */
export async function isLockHeld(resourceId: string): Promise<boolean> {
  return defaultLockManager.isLocked(resourceId);
}

/**
 * Get the current holder of a lock.
 *
 * @param resourceId - Resource to check
 * @returns Agent ID of lock holder, or undefined if not locked
 */
export async function getLockHolder(
  resourceId: string,
): Promise<string | undefined> {
  return defaultLockManager.getHolder(resourceId);
}

/**
 * Extend an existing lock's TTL.
 *
 * @param resourceId - Resource with the lock
 * @param agentId - Agent holding the lock
 * @param additionalMs - Additional time to add to lock
 * @returns True if lock was extended
 */
export async function extendLock(
  resourceId: string,
  agentId: string,
  additionalMs: number,
): Promise<boolean> {
  return defaultLockManager.extend(resourceId, agentId, additionalMs);
}

// -----------------------------------------------------------------------------
// LOCK MANAGER CLASS
// -----------------------------------------------------------------------------

/**
 * In-memory lock manager implementation.
 * Implements the LockManager interface for pluggable lock backends.
 */
export class InMemoryLockManager implements LockManager {
  private readonly activeLocks = new Map<string, LockEntry>();

  async acquire(
    resourceId: string,
    agentId: string,
    timeoutMs: number,
  ): Promise<LockAcquisitionResult> {
    const now = Date.now();
    const existing = this.activeLocks.get(resourceId);

    // Check if lock exists and is still valid
    if (existing && existing.expires > now) {
      // Lock is held by someone else
      if (existing.agentId !== agentId) {
        return {
          acquired: false,
          reason: "already_held",
          heldBy: existing.agentId,
        };
      }
      // Same agent - extend the lock
      const extended: LockEntry = {
        ...existing,
        expires: now + timeoutMs,
      };
      this.activeLocks.set(resourceId, extended);
      return { acquired: true, lock: extended };
    }

    // Lock is free or expired - acquire it
    const lock: LockEntry = {
      agentId,
      resourceId,
      expires: now + timeoutMs,
      acquiredAt: now,
    };

    this.activeLocks.set(resourceId, lock);
    return { acquired: true, lock };
  }

  async release(resourceId: string, agentId: string): Promise<boolean> {
    const existing = this.activeLocks.get(resourceId);

    // Lock doesn't exist or is expired - consider it released
    if (!existing || existing.expires <= Date.now()) {
      this.activeLocks.delete(resourceId);
      return true;
    }

    // Only the holder can release
    if (existing.agentId !== agentId) {
      return false;
    }

    this.activeLocks.delete(resourceId);
    return true;
  }

  async isLocked(resourceId: string): Promise<boolean> {
    const existing = this.activeLocks.get(resourceId);
    if (!existing) return false;

    // Clean up expired lock
    if (existing.expires <= Date.now()) {
      this.activeLocks.delete(resourceId);
      return false;
    }

    return true;
  }

  async getHolder(resourceId: string): Promise<string | undefined> {
    const existing = this.activeLocks.get(resourceId);
    if (!existing || existing.expires <= Date.now()) {
      this.activeLocks.delete(resourceId);
      return undefined;
    }
    return existing.agentId;
  }

  async extend(
    resourceId: string,
    agentId: string,
    additionalMs: number,
  ): Promise<boolean> {
    const existing = this.activeLocks.get(resourceId);

    // Lock doesn't exist or is expired
    if (!existing || existing.expires <= Date.now()) {
      return false;
    }

    // Only holder can extend
    if (existing.agentId !== agentId) {
      return false;
    }

    // Fix[CR-306]: write a new Map entry instead of mutating the stored object
    // in-place.  Callers that captured a reference to the original LockEntry
    // (e.g. from acquire() or getActiveLocks()) must not observe the extended
    // expiry through their reference � that is the M7 immutability contract.
    this.activeLocks.set(resourceId, {
      ...existing,
      expires: existing.expires + additionalMs,
    });
    return true;
  }

  /**
   * Get active locks for this manager instance.
   * @returns Array of active lock entries
   */
  getActiveLocks(): LockEntry[] {
    const now = Date.now();
    const active: LockEntry[] = [];

    for (const [, lock] of this.activeLocks) {
      if (lock.expires > now) {
        active.push({ ...lock });
      }
    }

    return active;
  }

  /**
   * Clear all locks held by this manager instance.
   */
  clearAllLocks(): void {
    this.activeLocks.clear();
  }

  /**
   * Force release a lock from this manager regardless of holder.
   */
  forceRelease(resourceId: string): boolean {
    return this.activeLocks.delete(resourceId);
  }

  /**
   * Clean up expired locks in this manager instance.
   *
   * @returns Number of expired locks cleaned up
   */
  cleanupExpiredLocks(): number {
    const now = Date.now();
    let count = 0;

    for (const [resourceId, lock] of this.activeLocks) {
      if (lock.expires <= now) {
        this.activeLocks.delete(resourceId);
        count++;
      }
    }

    return count;
  }
}

// -----------------------------------------------------------------------------
// UTILITY FUNCTIONS
// -----------------------------------------------------------------------------

/**
 * Get all active locks (for debugging/monitoring).
 * @returns Array of all active lock entries
 */
export function getActiveLocks(): LockEntry[] {
  return defaultLockManager.getActiveLocks();
}

/**
 * Clear all locks (for testing).
 * @internal
 */
export function clearAllLocks(): void {
  defaultLockManager.clearAllLocks();
}

/**
 * Force release a lock regardless of holder (admin operation).
 * @internal
 */
export function forceReleaseLock(resourceId: string): boolean {
  return defaultLockManager.forceRelease(resourceId);
}

/**
 * Clean up expired locks.
 * Call periodically to prevent memory leaks in long-running processes.
 *
 * @returns Number of expired locks cleaned up
 */
export function cleanupExpiredLocks(): number {
  return defaultLockManager.cleanupExpiredLocks();
}

// -----------------------------------------------------------------------------
// DEFAULT INSTANCE
// -----------------------------------------------------------------------------

/**
 * Default lock manager instance.
 * Use this for standard in-memory locking.
 */
export const defaultLockManager = new InMemoryLockManager();
