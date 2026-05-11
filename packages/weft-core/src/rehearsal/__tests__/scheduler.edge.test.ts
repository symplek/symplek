/**
 * @fileoverview Edge case tests for Dependency Scheduler
 * @module weft-core/rehearsal/__tests__/scheduler.edge
 */

import { describe, expect, it } from "vitest";
import {
  DependencyScheduler,
  groupByAgent,
  sortByTimestamp,
} from "../scheduler";
import type { TraceEvent } from "../types";

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

describe("DependencyScheduler Edge Cases", () => {
  describe("Large Event Arrays", () => {
    it("should handle 10,000 events", () => {
      const events = Array.from({ length: 10000 }, (_, i) =>
        createEvent(`e${i}`, "agent-1", i * 1000, { "agent-1": i + 1 }),
      );

      const scheduler = new DependencyScheduler(events);
      expect(scheduler.getTotalEvents()).toBe(10000);

      let count = 0;
      while (scheduler.hasNext()) {
        scheduler.next();
        count++;
      }
      expect(count).toBe(10000);
    });

    it("should handle events with same timestamp", () => {
      const timestamp = Date.now();
      const events = [
        createEvent("e1", "agent-1", timestamp, { "agent-1": 1 }),
        createEvent("e2", "agent-2", timestamp, { "agent-2": 1 }),
        createEvent("e3", "agent-3", timestamp, { "agent-3": 1 }),
      ];

      const scheduler = new DependencyScheduler(events);
      // Should still process all events
      let count = 0;
      while (scheduler.hasNext()) {
        scheduler.next();
        count++;
      }
      expect(count).toBe(3);
    });
  });

  describe("Circular Dependencies", () => {
    it("should handle circular dependencies by falling back to timestamp", () => {
      // Create events that form a cycle (shouldn't happen in practice, but test robustness)
      const timestamp = Date.now();
      const events = [
        createEvent("e1", "agent-1", timestamp, { "agent-1": 1, "agent-2": 0 }),
        createEvent("e2", "agent-2", timestamp + 1, {
          "agent-1": 0,
          "agent-2": 1,
        }),
        createEvent("e3", "agent-1", timestamp + 2, {
          "agent-1": 2,
          "agent-2": 1,
        }),
      ];

      // Should not throw, should use timestamp ordering
      const scheduler = new DependencyScheduler(events);
      expect(() => {
        while (scheduler.hasNext()) {
          scheduler.next();
        }
      }).not.toThrow();
    });
  });

  describe("Concurrent Events", () => {
    it("should handle many concurrent events", () => {
      const timestamp = Date.now();
      const events = Array.from({ length: 100 }, (_, i) =>
        createEvent(`e${i}`, `agent-${i}`, timestamp, { [`agent-${i}`]: 1 }),
      );

      const scheduler = new DependencyScheduler(events);
      // All concurrent, should use timestamp ordering
      const processed = [];
      while (scheduler.hasNext()) {
        processed.push(scheduler.next().id);
      }

      expect(processed).toHaveLength(100);
    });
  });

  describe("Skip Operations", () => {
    it("should handle skipTo at boundaries", () => {
      const events = Array.from({ length: 10 }, (_, i) =>
        createEvent(`e${i}`, "agent-1", i * 1000, { "agent-1": i + 1 }),
      );

      const scheduler = new DependencyScheduler(events);

      // Skip to start
      scheduler.skipTo(0);
      expect(scheduler.getCurrentIndex()).toBe(0);

      // Skip to end
      scheduler.skipTo(9);
      expect(scheduler.getCurrentIndex()).toBe(9);
      expect(scheduler.next().id).toBe("e9");
    });

    it("should throw for skipTo out of bounds", () => {
      const events = [createEvent("e1", "agent-1", 1000, { "agent-1": 1 })];
      const scheduler = new DependencyScheduler(events);

      expect(() => scheduler.skipTo(-1)).toThrow();
      expect(() => scheduler.skipTo(10)).toThrow();
    });
  });

  describe("Reset Operations", () => {
    it("should reset correctly after partial consumption", () => {
      const events = Array.from({ length: 100 }, (_, i) =>
        createEvent(`e${i}`, "agent-1", i * 1000, { "agent-1": i + 1 }),
      );

      const scheduler = new DependencyScheduler(events);

      // Consume 50 events
      for (let i = 0; i < 50; i++) {
        scheduler.next();
      }

      scheduler.reset();
      expect(scheduler.getCurrentIndex()).toBe(0);
      expect(scheduler.hasNext()).toBe(true);
      expect(scheduler.next().id).toBe("e0");
    });
  });

  describe("Empty and Single Event", () => {
    it("should handle empty event array", () => {
      const scheduler = new DependencyScheduler([]);
      expect(scheduler.hasNext()).toBe(false);
      expect(scheduler.getTotalEvents()).toBe(0);
      expect(() => scheduler.next()).toThrow();
    });

    it("should handle single event", () => {
      const event = createEvent("e1", "agent-1", 1000, { "agent-1": 1 });
      const scheduler = new DependencyScheduler([event]);

      expect(scheduler.hasNext()).toBe(true);
      expect(scheduler.next()).toEqual(event);
      expect(scheduler.hasNext()).toBe(false);
    });
  });
});

describe("Utility Functions Edge Cases", () => {
  describe("sortByTimestamp", () => {
    it("should handle events with identical timestamps", () => {
      const timestamp = Date.now();
      const events = [
        createEvent("e3", "agent-1", timestamp, {}),
        createEvent("e1", "agent-1", timestamp, {}),
        createEvent("e2", "agent-1", timestamp, {}),
      ];

      const sorted = sortByTimestamp(events);
      // Should preserve relative order for identical timestamps
      expect(sorted).toHaveLength(3);
    });

    it("should handle very large timestamp differences", () => {
      const events = [
        createEvent("e1", "agent-1", Number.MAX_SAFE_INTEGER, {}),
        createEvent("e2", "agent-1", 0, {}),
      ];

      const sorted = sortByTimestamp(events);
      expect(sorted[0].id).toBe("e2");
      expect(sorted[1].id).toBe("e1");
    });
  });

  describe("groupByAgent", () => {
    it("should handle events with empty agent IDs", () => {
      const events = [
        createEvent("e1", "", 1000, {}),
        createEvent("e2", "", 2000, {}),
      ];

      const groups = groupByAgent(events);
      expect(groups.get("")).toHaveLength(2);
    });

    it("should handle events with many different agents", () => {
      const events = Array.from({ length: 1000 }, (_, i) =>
        createEvent(`e${i}`, `agent-${i}`, i * 1000, {}),
      );

      const groups = groupByAgent(events);
      expect(groups.size).toBe(1000);
      groups.forEach((agentEvents) => {
        expect(agentEvents).toHaveLength(1);
      });
    });
  });
});
