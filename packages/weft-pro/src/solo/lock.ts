/**
 * @fileoverview Distributed Lock Manager (re-export from weft-core)
 * @description Re-exports InMemoryLockManager and lock functions from weft-core.
 * @module weft-pro/solo/lock
 * @since 2.2.1
 */

export {
  InMemoryLockManager,
  defaultLockManager,
  acquireLock,
  releaseLock,
  isLockHeld,
  getLockHolder,
  extendLock,
  getActiveLocks,
  clearAllLocks,
  forceReleaseLock,
  cleanupExpiredLocks,
} from "weft-core";
