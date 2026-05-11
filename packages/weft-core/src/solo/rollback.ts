/**
 * @fileoverview Rollback Manager for Solo Mechanism
 * @description Checkpoint-based rollback for autonomous agent actions
 * @module @weft/core/solo/rollback
 * @since 2.2.0
 *
 * 📝 BUILD[STORY-01.09]: Rollback manager implementation
 *
 * @remarks
 * The rollback system provides:
 * - Checkpoint creation: Capture state before risky operations
 * - State restoration: Revert to checkpoint on failure
 * - Validation: Optionally validate restored state
 * - Integration: Works with transaction log for complete audit trail
 */

import type {
  Checkpoint,
  RollbackHandler,
  RollbackOptions,
  RollbackResult,
} from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// CHECKPOINT STORE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Global checkpoint store for in-memory implementation.
 * @internal
 */
const checkpoints = new Map<string, Checkpoint<unknown>>();

// ─────────────────────────────────────────────────────────────────────────────
// ID GENERATION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Generate a unique checkpoint ID.
 * Format: chk_{timestamp}_{random}
 */
function generateCheckpointId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 11);
  return `chk_${timestamp}_${random}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// CORE ROLLBACK FUNCTIONS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Execute an action with automatic rollback on failure.
 *
 * @param action - The action to execute
 * @param handler - Rollback handler with checkpoint/restore functions
 * @param options - Rollback options
 * @returns The action result
 * @throws Original error after rollback, or RollbackError if rollback fails
 *
 * @example
 * ```typescript
 * const result = await executeWithRollback(
 *   async () => updateDatabase(data),
 *   {
 *     checkpoint: () => getCurrentState(),
 *     restore: (state) => setCurrentState(state),
 *   }
 * );
 * ```
 */
export async function executeWithRollback<T, S>(
  action: () => Promise<T>,
  handler: RollbackHandler<S>,
  options: RollbackOptions = {},
): Promise<T> {
  // Create checkpoint before action
  const checkpointState = handler.checkpoint();
  const checkpointId = generateCheckpointId();

  // Store checkpoint
  const checkpoint: Checkpoint<S> = {
    id: checkpointId,
    state: checkpointState,
    timestamp: Date.now(),
  };
  checkpoints.set(checkpointId, checkpoint as Checkpoint<unknown>);

  try {
    // Execute the action
    const result = await action();

    // Success - remove checkpoint
    checkpoints.delete(checkpointId);
    return result;
  } catch (error) {
    // Action failed - attempt rollback
    const rollbackResult = await performRollback(
      checkpointId,
      checkpointState,
      handler,
      options,
    );

    // Clean up checkpoint
    checkpoints.delete(checkpointId);

    // If rollback failed, throw RollbackError
    if (!rollbackResult.success && rollbackResult.error) {
      throw rollbackResult.error;
    }

    // Rollback succeeded - re-throw original error
    throw error;
  }
}

/**
 * Perform rollback to a checkpoint.
 *
 * @param checkpointId - ID of the checkpoint
 * @param state - State to restore
 * @param handler - Rollback handler
 * @param options - Rollback options
 * @returns Rollback result
 */
async function performRollback<S>(
  checkpointId: string,
  state: S,
  handler: RollbackHandler<S>,
  options: RollbackOptions,
): Promise<RollbackResult> {
  const startTime = Date.now();
  const maxRetries = options.maxRetries ?? 1;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      // Restore state
      await handler.restore(state);

      // Optionally validate restored state
      if (options.validateAfterRestore && handler.validate) {
        const isValid = handler.validate(state);
        if (!isValid) {
          throw new Error("Restored state failed validation");
        }
      }

      // Success callback
      await options.onRollback?.(checkpointId);

      return {
        success: true,
        checkpointId,
        durationMs: Date.now() - startTime,
      };
    } catch (error) {
      // Last attempt failed
      if (attempt === maxRetries - 1) {
        const rollbackError = new Error(
          `Rollback failed for checkpoint ${checkpointId}: ${error instanceof Error ? error.message : String(error)}`,
        );

        // Error callback
        await options.onRollbackError?.(rollbackError);

        return {
          success: false,
          checkpointId,
          error: rollbackError,
          durationMs: Date.now() - startTime,
        };
      }
    }
  }

  // Should not reach here, but TypeScript needs this
  return {
    success: false,
    checkpointId,
    error: new Error("Unexpected rollback failure"),
    durationMs: Date.now() - startTime,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// CHECKPOINT MANAGEMENT
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create a manual checkpoint.
 *
 * @param state - State to checkpoint
 * @param transactionId - Optional associated transaction ID
 * @returns Checkpoint entry
 */
export function createCheckpoint<S>(
  state: S,
  transactionId?: string,
): Checkpoint<S> {
  const checkpoint: Checkpoint<S> = {
    id: generateCheckpointId(),
    state,
    timestamp: Date.now(),
    transactionId,
  };

  checkpoints.set(checkpoint.id, checkpoint as Checkpoint<unknown>);
  return checkpoint;
}

/**
 * Get a checkpoint by ID.
 *
 * @param id - Checkpoint ID
 * @returns Checkpoint or undefined
 */
export function getCheckpoint<S>(id: string): Checkpoint<S> | undefined {
  const checkpoint = checkpoints.get(id);
  return checkpoint as Checkpoint<S> | undefined;
}

/**
 * Remove a checkpoint.
 *
 * @param id - Checkpoint ID
 * @returns True if checkpoint was removed
 */
export function removeCheckpoint(id: string): boolean {
  return checkpoints.delete(id);
}

/**
 * Get all active checkpoints.
 *
 * @returns Array of checkpoint entries
 */
export function getActiveCheckpoints(): Checkpoint<unknown>[] {
  return Array.from(checkpoints.values());
}

/**
 * Clear old checkpoints.
 *
 * @param olderThanMs - Maximum age in milliseconds
 * @returns Number of cleared checkpoints
 */
export function clearOldCheckpoints(olderThanMs: number): number {
  const cutoff = Date.now() - olderThanMs;
  let count = 0;

  for (const [id, checkpoint] of checkpoints) {
    if (checkpoint.timestamp < cutoff) {
      checkpoints.delete(id);
      count++;
    }
  }

  return count;
}

/**
 * Clear all checkpoints (for testing).
 * @internal
 */
export function clearAllCheckpoints(): void {
  checkpoints.clear();
}

// ─────────────────────────────────────────────────────────────────────────────
// UTILITY FUNCTIONS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create a simple object rollback handler.
 * Useful for rolling back plain object state.
 *
 * @param getState - Function to get current state
 * @param setState - Function to set state
 * @returns RollbackHandler
 */
export function createObjectRollbackHandler<T>(
  getState: () => T,
  setState: (state: T) => void,
): RollbackHandler<T> {
  return {
    checkpoint: () => structuredClone(getState()),
    restore: (state) => setState(structuredClone(state)),
  };
}

/**
 * Create a rollback handler with validation.
 *
 * @param handler - Base rollback handler
 * @param validator - Validation function
 * @returns RollbackHandler with validation
 */
export function withValidation<S>(
  handler: RollbackHandler<S>,
  validator: (state: S) => boolean,
): RollbackHandler<S> {
  return {
    ...handler,
    validate: validator,
  };
}

/**
 * Compose multiple rollback handlers.
 * Executes rollbacks in reverse order (last handler first).
 *
 * @param handlers - Array of rollback handlers
 * @returns Combined rollback handler
 */
export function composeRollbackHandlers<S extends object>(
  handlers: Array<RollbackHandler<Partial<S>>>,
): RollbackHandler<S> {
  return {
    checkpoint: () => {
      const combined: Partial<S> = {};
      for (const handler of handlers) {
        Object.assign(combined, handler.checkpoint());
      }
      return combined as S;
    },
    restore: async (state) => {
      // Restore in reverse order
      for (let i = handlers.length - 1; i >= 0; i--) {
        await handlers[i].restore(state);
      }
    },
  };
}
