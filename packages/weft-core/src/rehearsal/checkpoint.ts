/**
 * @fileoverview Checkpoint Manager for partial replay support
 * @description Manages state snapshots for efficient trace replay
 * @module @weft/core/rehearsal/checkpoint
 * @since 1.0.0
 *
 * 📝 BUILD[03.04]: Checkpoint Manager implementation
 */

import type { Checkpoint, ExecutionTrace, VectorClock } from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// CHECKPOINT MANAGER
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Manager for checkpoints within an execution trace.
 * Enables efficient partial replay by jumping to saved state.
 *
 * @example
 * ```typescript
 * const manager = new CheckpointManager(trace);
 *
 * // Get checkpoint before a specific event
 * const checkpoint = manager.getCheckpointBefore(eventIndex);
 *
 * // Restore state from checkpoint
 * const state = manager.restoreState(checkpoint);
 *
 * // Find nearest checkpoint
 * const nearest = manager.getNearestCheckpoint(targetEvent);
 * ```
 */
export class CheckpointManager {
  private readonly checkpoints: readonly Checkpoint[];
  private readonly checkpointsByIndex: Map<number, Checkpoint>;

  constructor(trace: ExecutionTrace) {
    this.checkpoints = trace.checkpoints;
    this.checkpointsByIndex = new Map(
      this.checkpoints.map((cp) => [cp.eventIndex, cp]),
    );
  }

  /**
   * Get all checkpoints.
   */
  getAllCheckpoints(): readonly Checkpoint[] {
    return this.checkpoints;
  }

  /**
   * Get checkpoint by ID.
   *
   * @param id - Checkpoint ID
   * @returns The checkpoint, or undefined if not found
   */
  getCheckpointById(id: string): Checkpoint | undefined {
    return this.checkpoints.find((cp) => cp.id === id);
  }

  /**
   * Get checkpoint at a specific event index.
   *
   * @param eventIndex - Event index where checkpoint was created
   * @returns The checkpoint, or undefined if none at that index
   */
  getCheckpointAtIndex(eventIndex: number): Checkpoint | undefined {
    return this.checkpointsByIndex.get(eventIndex);
  }

  /**
   * Get the nearest checkpoint before or at an event index.
   * Returns the checkpoint that allows replaying from the closest point.
   *
   * @param eventIndex - Target event index
   * @returns The nearest checkpoint, or undefined if none before
   */
  getNearestCheckpointBefore(eventIndex: number): Checkpoint | undefined {
    let nearest: Checkpoint | undefined;

    for (const checkpoint of this.checkpoints) {
      if (checkpoint.eventIndex <= eventIndex) {
        if (!nearest || checkpoint.eventIndex > nearest.eventIndex) {
          nearest = checkpoint;
        }
      }
    }

    return nearest;
  }

  /**
   * Get checkpoints within an event index range.
   *
   * @param startIndex - Start event index (inclusive)
   * @param endIndex - End event index (inclusive)
   * @returns Checkpoints in the range
   */
  getCheckpointsInRange(startIndex: number, endIndex: number): Checkpoint[] {
    return this.checkpoints.filter(
      (cp) => cp.eventIndex >= startIndex && cp.eventIndex <= endIndex,
    );
  }

  /**
   * Restore state from a checkpoint.
   * Deep clones the state to prevent mutation.
   *
   * @param checkpoint - The checkpoint to restore from
   * @returns Deep clone of the checkpoint state
   */
  restoreState<T>(checkpoint: Checkpoint): T {
    return JSON.parse(JSON.stringify(checkpoint.state)) as T;
  }

  /**
   * Verify checkpoint integrity by comparing hash.
   *
   * @param checkpoint - The checkpoint to verify
   * @returns true if state hash matches
   */
  verifyCheckpoint(checkpoint: Checkpoint): boolean {
    const currentHash = this.computeHash(checkpoint.state);
    return currentHash === checkpoint.stateHash;
  }

  /**
   * Get total checkpoint count.
   */
  getCheckpointCount(): number {
    return this.checkpoints.length;
  }

  /**
   * Check if any checkpoints exist.
   */
  hasCheckpoints(): boolean {
    return this.checkpoints.length > 0;
  }

  /**
   * Compute DJB2 hash of state.
   */
  private computeHash(state: unknown): string {
    const content = JSON.stringify(state);
    let hash = 5381;
    for (let i = 0; i < content.length; i++) {
      hash = (hash * 33) ^ content.charCodeAt(i);
    }
    return (hash >>> 0).toString(16).padStart(8, "0");
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// CHECKPOINT CREATION UTILITIES
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create a checkpoint object from state.
 *
 * @param state - State to checkpoint
 * @param vectorClock - Current vector clock
 * @param eventIndex - Current event index
 * @returns A new Checkpoint
 */
export function createCheckpoint<T>(
  state: T,
  vectorClock: VectorClock,
  eventIndex: number,
): Checkpoint {
  const id = `chk_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 6)}`;
  const serializedState = JSON.parse(JSON.stringify(state));
  const stateHash = computeStateHash(serializedState);

  return {
    id,
    vectorClock: { ...vectorClock },
    state: serializedState,
    timestamp: Date.now(),
    stateHash,
    eventIndex,
  };
}

/**
 * Compute hash of checkpoint state.
 */
function computeStateHash(state: unknown): string {
  const content = JSON.stringify(state);
  let hash = 5381;
  for (let i = 0; i < content.length; i++) {
    hash = (hash * 33) ^ content.charCodeAt(i);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/**
 * Restore state from a checkpoint with type safety.
 *
 * @param checkpoint - The checkpoint to restore from
 * @returns Deep clone of the state
 */
export function restoreFromCheckpoint<T>(checkpoint: Checkpoint): T {
  return JSON.parse(JSON.stringify(checkpoint.state)) as T;
}
