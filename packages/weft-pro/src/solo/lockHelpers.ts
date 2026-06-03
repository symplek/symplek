/**
 * @module weft-pro/solo/lockHelpers - Pure Map-based lock algorithm helpers
 * @description Internal helpers for InMemoryLockManager. Not exported from solo/index.ts.
 * @since 2.2.1
 * @internal
 */

import type { LockAcquisitionResult, LockEntry } from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// PURE ALGORITHM HELPERS (take the Map as a parameter)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Core lock-acquisition logic operating on an arbitrary Map.
 * @internal
 */
export function _acquireFromMap(
  locks: Map<string, LockEntry>,
  resourceId: string,
  agentId: string,
  timeoutMs: number,
): LockAcquisitionResult {
  const now = Date.now();
  const existing = locks.get(resourceId);

  if (existing && existing.expires > now) {
    if (existing.agentId !== agentId) {
      return {
        acquired: false,
        reason: "already_held",
        heldBy: existing.agentId,
      };
    }
    // Same agent — extend in place (new entry, not mutation)
    const extended: LockEntry = { ...existing, expires: now + timeoutMs };
    locks.set(resourceId, extended);
    return { acquired: true, lock: extended };
  }

  const lock: LockEntry = {
    agentId,
    resourceId,
    expires: now + timeoutMs,
    acquiredAt: now,
  };
  locks.set(resourceId, lock);
  return { acquired: true, lock };
}

/**
 * Core lock-release logic operating on an arbitrary Map.
 * @internal
 */
export function _releaseFromMap(
  locks: Map<string, LockEntry>,
  resourceId: string,
  agentId: string,
): boolean {
  const existing = locks.get(resourceId);
  if (!existing || existing.expires <= Date.now()) {
    locks.delete(resourceId);
    return true;
  }
  if (existing.agentId !== agentId) return false;
  locks.delete(resourceId);
  return true;
}

/**
 * Core isLocked check operating on an arbitrary Map.
 * @internal
 */
export function _isLockedInMap(
  locks: Map<string, LockEntry>,
  resourceId: string,
): boolean {
  const existing = locks.get(resourceId);
  if (!existing) return false;
  if (existing.expires <= Date.now()) {
    locks.delete(resourceId);
    return false;
  }
  return true;
}

/**
 * Core getHolder lookup operating on an arbitrary Map.
 * @internal
 */
export function _getHolderFromMap(
  locks: Map<string, LockEntry>,
  resourceId: string,
): string | undefined {
  const existing = locks.get(resourceId);
  if (!existing || existing.expires <= Date.now()) return undefined;
  return existing.agentId;
}

/**
 * Core extendLock operating on an arbitrary Map.
 * Writes a NEW entry — does not mutate the existing object in place (M7 fix).
 * @internal
 */
export function _extendInMap(
  locks: Map<string, LockEntry>,
  resourceId: string,
  agentId: string,
  additionalMs: number,
): boolean {
  const existing = locks.get(resourceId);
  if (!existing || existing.expires <= Date.now()) return false;
  if (existing.agentId !== agentId) return false;
  // New object — never mutates existing reference
  locks.set(resourceId, { ...existing, expires: existing.expires + additionalMs });
  return true;
}

/**
 * Return all unexpired lock entries from an arbitrary Map.
 * @internal
 */
export function _getActiveFromMap(locks: Map<string, LockEntry>): LockEntry[] {
  const now = Date.now();
  const active: LockEntry[] = [];
  for (const [, lock] of locks) {
    if (lock.expires > now) active.push({ ...lock });
  }
  return active;
}

/**
 * Remove expired entries from an arbitrary Map; return count removed.
 * @internal
 */
export function _cleanupFromMap(locks: Map<string, LockEntry>): number {
  const now = Date.now();
  let count = 0;
  for (const [resourceId, lock] of locks) {
    if (lock.expires <= now) {
      locks.delete(resourceId);
      count++;
    }
  }
  return count;
}
