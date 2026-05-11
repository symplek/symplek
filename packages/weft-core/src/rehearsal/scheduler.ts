/**
 * @fileoverview Dependency Scheduler for deterministic event ordering
 * @description Topological sort of trace events using vector clocks
 * @module weft-core/rehearsal/scheduler
 * @since 1.0.0
 *
 * 📝 BUILD[01.03]: Dependency Scheduler for deterministic ordering
 */

import type { TraceEvent } from "./types";
import { compareClock, happensBefore } from "./vectorClock";

// ─────────────────────────────────────────────────────────────────────────────
// DEPENDENCY SCHEDULER
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Scheduler that orders events by causal dependencies using vector clocks.
 *
 * Uses Kahn's algorithm for topological sort:
 * 1. Find events with all dependencies satisfied
 * 2. Process them, mark as complete
 * 3. Repeat until all events processed
 *
 * For concurrent events (neither happens-before), falls back to timestamp ordering.
 *
 * @example
 * ```typescript
 * const scheduler = new DependencyScheduler(events);
 *
 * while (scheduler.hasNext()) {
 *   const event = scheduler.next();
 *   await processEvent(event);
 * }
 * ```
 */
export class DependencyScheduler {
  private readonly sortedEvents: readonly TraceEvent[];
  private currentIndex: number = 0;

  /**
   * Create a scheduler from trace events.
   *
   * @param events - Array of trace events to schedule
   */
  constructor(events: readonly TraceEvent[]) {
    this.sortedEvents = this.sortByCausalOrder([...events]);
  }

  /**
   * Check if there are more events to process.
   *
   * @returns true if more events remain
   */
  hasNext(): boolean {
    return this.currentIndex < this.sortedEvents.length;
  }

  /**
   * Get the next event to process.
   *
   * @returns The next event in causal order
   * @throws Error if no more events
   */
  next(): TraceEvent {
    if (!this.hasNext()) {
      throw new Error("DependencyScheduler exhausted - no more events");
    }
    return this.sortedEvents[this.currentIndex++];
  }

  /**
   * Peek at the next event without advancing.
   *
   * @returns The next event, or undefined if exhausted
   */
  peek(): TraceEvent | undefined {
    return this.sortedEvents[this.currentIndex];
  }

  /**
   * Skip to a specific position in the event sequence.
   * Used for checkpoint-based partial replay.
   *
   * @param index - The index to skip to
   * @throws Error if index is out of bounds
   */
  skipTo(index: number): void {
    if (index < 0 || index > this.sortedEvents.length) {
      throw new Error(
        `Invalid skip index ${index} (valid range: 0-${this.sortedEvents.length})`,
      );
    }
    this.currentIndex = index;
  }

  /**
   * Get the current position in the event sequence.
   *
   * @returns The current index
   */
  getCurrentIndex(): number {
    return this.currentIndex;
  }

  /**
   * Get the total number of events.
   *
   * @returns Total event count
   */
  getTotalEvents(): number {
    return this.sortedEvents.length;
  }

  /**
   * Get all events in sorted order (for debugging).
   *
   * @returns Read-only array of sorted events
   */
  getAllEvents(): readonly TraceEvent[] {
    return this.sortedEvents;
  }

  /**
   * Reset the scheduler to the beginning.
   */
  reset(): void {
    this.currentIndex = 0;
  }

  /**
   * Sort events by causal order using topological sort.
   *
   * Algorithm:
   * 1. Build dependency graph from vector clocks
   * 2. Find events with no unsatisfied dependencies
   * 3. Add to result, mark as processed
   * 4. Repeat until all events processed
   * 5. For cycles/concurrent events, use timestamp as tiebreaker
   *
   * @param events - Events to sort
   * @returns Events in causal order
   */
  private sortByCausalOrder(events: TraceEvent[]): TraceEvent[] {
    if (events.length <= 1) {
      return events;
    }

    // A pairwise comparator preserves causal ordering while avoiding the
    // quadratic dependency-graph build that made large traces appear hung.
    return events
      .map((event, index) => ({ event, index }))
      .sort((left, right) => {
        const clockOrder = compareClock(
          left.event.vectorClock,
          right.event.vectorClock,
        );
        if (clockOrder !== 0) {
          return clockOrder;
        }

        const timestampOrder = left.event.timestamp - right.event.timestamp;
        if (timestampOrder !== 0) {
          return timestampOrder;
        }

        return left.index - right.index;
      })
      .map(({ event }) => event);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// UTILITY FUNCTIONS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Sort events by timestamp (simple fallback ordering).
 *
 * @param events - Events to sort
 * @returns Events sorted by timestamp
 */
export function sortByTimestamp(events: readonly TraceEvent[]): TraceEvent[] {
  return [...events].sort((a, b) => a.timestamp - b.timestamp);
}

/**
 * Group events by agent ID.
 *
 * @param events - Events to group
 * @returns Map of agent ID to their events
 */
export function groupByAgent(
  events: readonly TraceEvent[],
): Map<string, TraceEvent[]> {
  const groups = new Map<string, TraceEvent[]>();

  for (const event of events) {
    const agentEvents = groups.get(event.agentId) ?? [];
    agentEvents.push(event);
    groups.set(event.agentId, agentEvents);
  }

  return groups;
}

/**
 * Find events that depend on a specific event.
 *
 * @param event - The event to find dependents for
 * @param allEvents - All events to search
 * @returns Events that depend on the given event
 */
export function findDependents(
  event: TraceEvent,
  allEvents: readonly TraceEvent[],
): TraceEvent[] {
  return allEvents.filter(
    (e) => e.id !== event.id && happensBefore(event.vectorClock, e.vectorClock),
  );
}
