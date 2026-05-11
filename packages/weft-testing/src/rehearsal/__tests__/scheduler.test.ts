/**
 * @fileoverview Unit tests for Dependency Scheduler
 * @module weft-core/rehearsal/__tests__/scheduler
 */

import { describe, expect, it } from "vitest";
import {
  DependencyScheduler,
  findDependents,
  groupByAgent,
  sortByTimestamp,
} from "../scheduler";
import type { TraceEvent } from "../types";

// Helper to create test events
function createEvent(
  id: string,
  agentId: string,
  timestamp: number,
  vectorClock: Record<string, number>,
): TraceEvent {
  return {
    id,
    type: "operator",
    agentId,
    timestamp,
    vectorClock,
    payload: { operator: "test", durationMs: 10 },
    hash: `hash_${id}`,
  };
}

describe("DependencyScheduler", () => {
  describe("constructor and basic operations", () => {
    it("should handle empty events array", () => {
      const scheduler = new DependencyScheduler([]);
      expect(scheduler.hasNext()).toBe(false);
      expect(scheduler.getTotalEvents()).toBe(0);
    });

    it("should handle single event", () => {
      const event = createEvent("e1", "agent-1", 1000, { "agent-1": 1 });
      const scheduler = new DependencyScheduler([event]);

      expect(scheduler.hasNext()).toBe(true);
      expect(scheduler.getTotalEvents()).toBe(1);
      expect(scheduler.next()).toEqual(event);
      expect(scheduler.hasNext()).toBe(false);
    });
  });

  describe("next and peek", () => {
    it("should return events in order", () => {
      const events = [
        createEvent("e1", "agent-1", 1000, { "agent-1": 1 }),
        createEvent("e2", "agent-1", 2000, { "agent-1": 2 }),
      ];
      const scheduler = new DependencyScheduler(events);

      expect(scheduler.next().id).toBe("e1");
      expect(scheduler.next().id).toBe("e2");
    });

    it("should peek without advancing", () => {
      const event = createEvent("e1", "agent-1", 1000, { "agent-1": 1 });
      const scheduler = new DependencyScheduler([event]);

      expect(scheduler.peek()?.id).toBe("e1");
      expect(scheduler.peek()?.id).toBe("e1");
      expect(scheduler.hasNext()).toBe(true);
    });

    it("should throw when exhausted", () => {
      const scheduler = new DependencyScheduler([]);
      expect(() => scheduler.next()).toThrow("DependencyScheduler exhausted");
    });

    it("peek should return undefined when exhausted", () => {
      const scheduler = new DependencyScheduler([]);
      expect(scheduler.peek()).toBeUndefined();
    });
  });

  describe("causal ordering", () => {
    it("should order events by happens-before relationship", () => {
      // e1 happens before e2 (based on vector clocks)
      const events = [
        createEvent("e2", "agent-1", 2000, { "agent-1": 2 }),
        createEvent("e1", "agent-1", 1000, { "agent-1": 1 }),
      ];

      const scheduler = new DependencyScheduler(events);

      // Despite e2 being first in array, e1 should come first due to vector clock
      expect(scheduler.next().id).toBe("e1");
      expect(scheduler.next().id).toBe("e2");
    });

    it("should use timestamp for concurrent events", () => {
      // Concurrent events (neither happens-before the other)
      const events = [
        createEvent("e2", "agent-2", 2000, { "agent-2": 1 }),
        createEvent("e1", "agent-1", 1000, { "agent-1": 1 }),
      ];

      const scheduler = new DependencyScheduler(events);

      // Concurrent, so use timestamp ordering
      expect(scheduler.next().id).toBe("e1");
      expect(scheduler.next().id).toBe("e2");
    });

    it("should handle complex dependency chains", () => {
      // e1 -> e2 -> e3 (linear chain)
      const events = [
        createEvent("e3", "agent-1", 3000, { "agent-1": 3 }),
        createEvent("e1", "agent-1", 1000, { "agent-1": 1 }),
        createEvent("e2", "agent-1", 2000, { "agent-1": 2 }),
      ];

      const scheduler = new DependencyScheduler(events);

      expect(scheduler.next().id).toBe("e1");
      expect(scheduler.next().id).toBe("e2");
      expect(scheduler.next().id).toBe("e3");
    });
  });

  describe("skipTo", () => {
    it("should skip to specified index", () => {
      const events = [
        createEvent("e1", "agent-1", 1000, { "agent-1": 1 }),
        createEvent("e2", "agent-1", 2000, { "agent-1": 2 }),
        createEvent("e3", "agent-1", 3000, { "agent-1": 3 }),
      ];
      const scheduler = new DependencyScheduler(events);

      scheduler.skipTo(2);
      expect(scheduler.getCurrentIndex()).toBe(2);
      expect(scheduler.next().id).toBe("e3");
    });

    it("should throw for invalid index", () => {
      const scheduler = new DependencyScheduler([]);
      expect(() => scheduler.skipTo(-1)).toThrow("Invalid skip index");
      expect(() => scheduler.skipTo(1)).toThrow("Invalid skip index");
    });
  });

  describe("reset", () => {
    it("should reset to beginning", () => {
      const events = [
        createEvent("e1", "agent-1", 1000, { "agent-1": 1 }),
        createEvent("e2", "agent-1", 2000, { "agent-1": 2 }),
      ];
      const scheduler = new DependencyScheduler(events);

      scheduler.next();
      scheduler.next();
      expect(scheduler.hasNext()).toBe(false);

      scheduler.reset();
      expect(scheduler.hasNext()).toBe(true);
      expect(scheduler.getCurrentIndex()).toBe(0);
    });
  });

  describe("getAllEvents", () => {
    it("should return all events in sorted order", () => {
      const events = [
        createEvent("e2", "agent-1", 2000, { "agent-1": 2 }),
        createEvent("e1", "agent-1", 1000, { "agent-1": 1 }),
      ];
      const scheduler = new DependencyScheduler(events);

      const sorted = scheduler.getAllEvents();
      expect(sorted[0].id).toBe("e1");
      expect(sorted[1].id).toBe("e2");
    });
  });
});

describe("sortByTimestamp", () => {
  it("should sort by timestamp ascending", () => {
    const events = [
      createEvent("e3", "agent-1", 3000, {}),
      createEvent("e1", "agent-1", 1000, {}),
      createEvent("e2", "agent-1", 2000, {}),
    ];

    const sorted = sortByTimestamp(events);
    expect(sorted.map((e) => e.id)).toEqual(["e1", "e2", "e3"]);
  });

  it("should not modify original array", () => {
    const events = [
      createEvent("e2", "agent-1", 2000, {}),
      createEvent("e1", "agent-1", 1000, {}),
    ];

    sortByTimestamp(events);
    expect(events[0].id).toBe("e2");
  });
});

describe("groupByAgent", () => {
  it("should group events by agent ID", () => {
    const events = [
      createEvent("e1", "agent-1", 1000, {}),
      createEvent("e2", "agent-2", 2000, {}),
      createEvent("e3", "agent-1", 3000, {}),
    ];

    const groups = groupByAgent(events);

    expect(groups.get("agent-1")).toHaveLength(2);
    expect(groups.get("agent-2")).toHaveLength(1);
    expect(groups.get("agent-1")?.map((e) => e.id)).toEqual(["e1", "e3"]);
  });

  it("should handle empty array", () => {
    const groups = groupByAgent([]);
    expect(groups.size).toBe(0);
  });
});

describe("findDependents", () => {
  it("should find events that depend on given event", () => {
    const e1 = createEvent("e1", "agent-1", 1000, { "agent-1": 1 });
    const e2 = createEvent("e2", "agent-1", 2000, { "agent-1": 2 });
    const e3 = createEvent("e3", "agent-1", 3000, { "agent-1": 3 });

    const dependents = findDependents(e1, [e1, e2, e3]);

    expect(dependents.map((e) => e.id)).toEqual(["e2", "e3"]);
  });

  it("should return empty for event with no dependents", () => {
    const e1 = createEvent("e1", "agent-1", 1000, { "agent-1": 1 });
    const dependents = findDependents(e1, [e1]);
    expect(dependents).toHaveLength(0);
  });
});
