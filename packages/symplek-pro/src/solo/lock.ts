/**
 * @fileoverview Distributed Lock Manager (re-export from @symplek/core)
 * @description Re-exports InMemoryLockManager and lock functions from @symplek/core.
 * @module @symplek/pro/solo/lock
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
} from "@symplek/core";
