/**
 * @fileoverview Distributed Lock Manager
 * @description In-memory lock implementation for solo mechanism
 * @module weft-core/solo/lock
 * @since 2.2.0
 *
 * 📝 BUILD[STORY-01.05]: Lock manager implementation
 *
 * @remarks
 * Implements a simple in-memory lock manager for MVP.
 * Inspired by Redlock algorithm but simplified for single-process use.
 * Can be replaced with Redis/Convex implementation for distributed scenarios.
 *
 * Thread safety: Uses synchronous operations on Map, safe for Node.js single-threaded model.
 * For multi-process scenarios, replace with distributed lock implementation.
 *
 * State isolation: each InMemoryLockManager instance maintains its own private lock Map.
 * Free-standing functions (acquireLock, releaseLock, etc.) delegate to the module-level
 * defaultLockManager singleton. Two separately constructed instances never share state.
 */

import type { LockAcquisitionResult, LockEntry, LockManager } from "./types";
import {
  _acquireFromMap,
  _cleanupFromMap,
  _extendInMap,
  _getActiveFromMap,
  _getHolderFromMap,
  _isLockedInMap,
  _releaseFromMap,
} from "./lockHelpers";

// ─────────────────────────────────────────────────────────────────────────────
// LOCK MANAGER CLASS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * In-memory lock manager with per-instance state isolation.
 *
 * Each instance maintains its own private lock store. Two instances of
 * InMemoryLockManager never share state — acquiring a lock on instance A does
 * not affect instance B, even for the same resourceId.
 *
 * The free-standing module functions (acquireLock, releaseLock, etc.) delegate
 * to the exported `defaultLockManager` singleton and share its state only.
 */
export class InMemoryLockManager implements LockManager {
  /** Per-instance isolated lock store. */
  private readonly locks = new Map<string, LockEntry>();

  async acquire(
    resourceId: string,
    agentId: string,
    timeoutMs: number,
  ): Promise<LockAcquisitionResult> {
    return _acquireFromMap(this.locks, resourceId, agentId, timeoutMs);
  }

  async release(resourceId: string, agentId: string): Promise<boolean> {
    return _releaseFromMap(this.locks, resourceId, agentId);
  }

  async isLocked(resourceId: string): Promise<boolean> {
    return _isLockedInMap(this.locks, resourceId);
  }

  async getHolder(resourceId: string): Promise<string | undefined> {
    return _getHolderFromMap(this.locks, resourceId);
  }

  async extend(
    resourceId: string,
    agentId: string,
    additionalMs: number,
  ): Promise<boolean> {
    return _extendInMap(this.locks, resourceId, agentId, additionalMs);
  }

  /**
   * Return all unexpired lock entries (for monitoring/debugging).
   */
  getActive(): LockEntry[] {
    return _getActiveFromMap(this.locks);
  }

  /**
   * Remove expired lock entries; return count removed.
   */
  cleanup(): number {
    return _cleanupFromMap(this.locks);
  }

  /**
   * Clear all locks in this instance.
   * @internal For testing only.
   */
  clearAll(): void {
    this.locks.clear();
  }

  /**
   * Force-delete a specific lock regardless of holder.
   * @internal Admin / emergency use only.
   */
  forceDelete(resourceId: string): boolean {
    return this.locks.delete(resourceId);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// DEFAULT INSTANCE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Default lock manager singleton.
 * Free-standing functions below delegate here; callers who import the
 * free-standing API share this instance's state.
 * Custom instances constructed with `new InMemoryLockManager()` are isolated.
 */
export const defaultLockManager = new InMemoryLockManager();

// ─────────────────────────────────────────────────────────────────────────────
// FREE-STANDING API (delegates to defaultLockManager — signatures unchanged)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Attempt to acquire a distributed lock on a resource.
 *
 * Delegates to `defaultLockManager`. Callers who need isolated state should
 * construct a `new InMemoryLockManager()` and call `.acquire()` directly.
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
 * Writes a new Map entry rather than mutating the existing object in place.
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

/**
 * Get all active locks (for debugging/monitoring).
 * @returns Array of all active lock entries from defaultLockManager
 */
export function getActiveLocks(): LockEntry[] {
  return defaultLockManager.getActive();
}

/**
 * Clear all locks in defaultLockManager (for testing).
 * Does NOT affect separately constructed InMemoryLockManager instances.
 * @internal
 */
export function clearAllLocks(): void {
  defaultLockManager.clearAll();
}

/**
 * Force release a lock regardless of holder (admin operation).
 * Operates on defaultLockManager only.
 * @internal
 */
export function forceReleaseLock(resourceId: string): boolean {
  return defaultLockManager.forceDelete(resourceId);
}

/**
 * Clean up expired locks in defaultLockManager.
 * Call periodically to prevent memory leaks in long-running processes.
 *
 * @returns Number of expired locks cleaned up
 */
export function cleanupExpiredLocks(): number {
  return defaultLockManager.cleanup();
}
