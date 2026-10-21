/**
 * @fileoverview Vector Clock Manager for causal ordering
 * @description Lamport-style vector clocks for multi-agent event ordering
 * @module @symplek/core/rehearsal/vectorClock
 * @since 1.0.0
 *
 * 📝 BUILD[01.02]: Vector Clock Manager for causal ordering
 */

import type { VectorClock } from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// VECTOR CLOCK OPERATIONS (Pure Functions)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create an empty vector clock.
 *
 * @returns A new empty vector clock
 */
export function createVectorClock(): VectorClock {
  return {};
}

/**
 * Increment the clock for a specific agent.
 *
 * @param clock - The current vector clock
 * @param agentId - The agent whose clock to increment
 * @returns A new vector clock with the agent's time incremented
 *
 * @example
 * ```typescript
 * const clock1 = createVectorClock();
 * const clock2 = incrementClock(clock1, 'agent-1'); // { 'agent-1': 1 }
 * const clock3 = incrementClock(clock2, 'agent-1'); // { 'agent-1': 2 }
 * ```
 */
export function incrementClock(
  clock: VectorClock,
  agentId: string,
): VectorClock {
  return {
    ...clock,
    [agentId]: (clock[agentId] ?? 0) + 1,
  };
}

/**
 * Merge two vector clocks (component-wise maximum).
 *
 * @param a - First vector clock
 * @param b - Second vector clock
 * @returns A new vector clock with component-wise maximum
 *
 * @example
 * ```typescript
 * const a = { 'agent-1': 3, 'agent-2': 1 };
 * const b = { 'agent-1': 1, 'agent-2': 5 };
 * const merged = mergeClock(a, b); // { 'agent-1': 3, 'agent-2': 5 }
 * ```
 */
export function mergeClock(a: VectorClock, b: VectorClock): VectorClock {
  const result: VectorClock = { ...a };

  for (const [agentId, time] of Object.entries(b)) {
    result[agentId] = Math.max(result[agentId] ?? 0, time);
  }

  return result;
}

/**
 * Check if clock A happens-before clock B.
 *
 * A happens-before B if:
 * - All components of A are ≤ corresponding components of B
 * - At least one component of A is strictly < corresponding component of B
 *
 * @param a - First vector clock
 * @param b - Second vector clock
 * @returns true if A happens-before B
 *
 * @example
 * ```typescript
 * const a = { 'agent-1': 1, 'agent-2': 0 };
 * const b = { 'agent-1': 2, 'agent-2': 1 };
 * happensBefore(a, b); // true
 * happensBefore(b, a); // false
 * ```
 */
export function happensBefore(a: VectorClock, b: VectorClock): boolean {
  let hasStrictlyLess = false;

  for (const agentId in a) {
    const timeB = b[agentId] ?? 0;
    if (a[agentId] > timeB) return false;
    if (a[agentId] < timeB) hasStrictlyLess = true;
  }

  if (!hasStrictlyLess) {
    for (const agentId in b) {
      if (!(agentId in a) && b[agentId] > 0) {
        hasStrictlyLess = true;
        break;
      }
    }
  }

  return hasStrictlyLess;
}

/**
 * Check if two clocks are concurrent (neither happens-before the other).
 *
 * @param a - First vector clock
 * @param b - Second vector clock
 * @returns true if events are concurrent
 *
 * @example
 * ```typescript
 * const a = { 'agent-1': 2, 'agent-2': 0 };
 * const b = { 'agent-1': 0, 'agent-2': 2 };
 * areConcurrent(a, b); // true - neither happens-before the other
 * ```
 */
export function areConcurrent(a: VectorClock, b: VectorClock): boolean {
  return !happensBefore(a, b) && !happensBefore(b, a);
}

/**
 * Compare two clocks for sorting.
 *
 * @param a - First vector clock
 * @param b - Second vector clock
 * @returns -1 if a < b, 1 if a > b, 0 if concurrent
 */
export function compareClock(a: VectorClock, b: VectorClock): -1 | 0 | 1 {
  let aGreater = false;
  let bGreater = false;

  for (const agentId in a) {
    const timeB = b[agentId] ?? 0;
    if (a[agentId] > timeB) aGreater = true;
    else if (a[agentId] < timeB) bGreater = true;
    if (aGreater && bGreater) return 0;
  }

  for (const agentId in b) {
    if (!(agentId in a) && b[agentId] > 0) {
      bGreater = true;
      if (aGreater) return 0;
    }
  }

  if (bGreater && !aGreater) return -1;
  if (aGreater && !bGreater) return 1;
  return 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// VECTOR CLOCK MANAGER CLASS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Manager for tracking and updating vector clocks during execution.
 *
 * @example
 * ```typescript
 * const manager = new VectorClockManager();
 *
 * // Agent 1 does work
 * manager.tick('agent-1');
 * manager.tick('agent-1');
 *
 * // Agent 2 receives clock from Agent 1
 * const clock1 = manager.getClock();
 * manager.receive('agent-2', clock1);
 *
 * // Check ordering
 * const result = VectorClockManager.happensBefore(clock1, manager.getClock());
 * ```
 */
export class VectorClockManager {
  private clock: VectorClock;

  constructor(initialClock?: VectorClock) {
    this.clock = initialClock ? { ...initialClock } : createVectorClock();
  }

  /**
   * Increment the clock for a specific agent (local event).
   *
   * @param agentId - The agent performing the event
   */
  tick(agentId: string): void {
    this.clock = incrementClock(this.clock, agentId);
  }

  /**
   * Receive a clock from another agent and merge.
   * Also increments the local agent's clock.
   *
   * @param agentId - The local agent receiving the message
   * @param remoteClock - The clock from the remote agent
   */
  receive(agentId: string, remoteClock: VectorClock): void {
    // Merge with remote clock
    this.clock = mergeClock(this.clock, remoteClock);
    // Increment local clock
    this.clock = incrementClock(this.clock, agentId);
  }

  /**
   * Get the current clock state (immutable copy).
   *
   * @returns A copy of the current vector clock
   */
  getClock(): VectorClock {
    return { ...this.clock };
  }

  /**
   * Reset the clock to empty state.
   */
  reset(): void {
    this.clock = createVectorClock();
  }

  /**
   * Static method to check happens-before relationship.
   *
   * @param a - First vector clock
   * @param b - Second vector clock
   * @returns true if a happens-before b
   */
  static happensBefore(a: VectorClock, b: VectorClock): boolean {
    return happensBefore(a, b);
  }

  /**
   * Static method to check concurrency.
   *
   * @param a - First vector clock
   * @param b - Second vector clock
   * @returns true if events are concurrent
   */
  static areConcurrent(a: VectorClock, b: VectorClock): boolean {
    return areConcurrent(a, b);
  }
}
