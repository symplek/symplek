/**
 * @fileoverview Edge case tests for Vector Clock operations
 * @module weft-core/rehearsal/__tests__/vectorClock.edge
 */

import { describe, expect, it } from "vitest";
import {
  areConcurrent,
  compareClock,
  createVectorClock,
  happensBefore,
  incrementClock,
  mergeClock,
  VectorClockManager,
} from "../vectorClock";

describe("VectorClock Edge Cases", () => {
  describe("Large Clocks", () => {
    it("should handle clocks with 1000+ agents", () => {
      let clock = createVectorClock();
      for (let i = 0; i < 1000; i++) {
        clock = incrementClock(clock, `agent-${i}`);
      }

      expect(Object.keys(clock)).toHaveLength(1000);
      expect(clock["agent-0"]).toBe(1);
      expect(clock["agent-999"]).toBe(1);
    });

    it("should handle very large clock values", () => {
      const clock = { "agent-1": Number.MAX_SAFE_INTEGER - 1 };
      const updated = incrementClock(clock, "agent-1");

      expect(updated["agent-1"]).toBe(Number.MAX_SAFE_INTEGER);
    });

    it("should handle merging clocks with 1000+ agents each", () => {
      let clockA = createVectorClock();
      let clockB = createVectorClock();

      for (let i = 0; i < 1000; i++) {
        clockA = incrementClock(clockA, `agent-${i}`);
        clockB = incrementClock(clockB, `agent-${i + 500}`);
      }

      const merged = mergeClock(clockA, clockB);
      expect(Object.keys(merged).length).toBeGreaterThan(1000);
    });
  });

  describe("Concurrent Modifications", () => {
    it("should not mutate original clock when incrementing", () => {
      const original = { "agent-1": 5, "agent-2": 3 };
      const copy = { ...original };

      incrementClock(original, "agent-1");

      expect(original).toEqual(copy);
    });

    it("should not mutate original clocks when merging", () => {
      const a = { "agent-1": 1 };
      const b = { "agent-2": 2 };
      const aCopy = { ...a };
      const bCopy = { ...b };

      mergeClock(a, b);

      expect(a).toEqual(aCopy);
      expect(b).toEqual(bCopy);
    });
  });

  describe("Empty and Null-like Values", () => {
    it("should handle empty string agent IDs", () => {
      const clock = incrementClock(createVectorClock(), "");
      expect(clock[""]).toBe(1);
    });

    it("should handle very long agent IDs", () => {
      const longId = "a".repeat(10000);
      const clock = incrementClock(createVectorClock(), longId);
      expect(clock[longId]).toBe(1);
    });

    it("should handle special characters in agent IDs", () => {
      const specialId = "agent-1@#$%^&*()";
      const clock = incrementClock(createVectorClock(), specialId);
      expect(clock[specialId]).toBe(1);
    });
  });

  describe("Zero and Negative Values", () => {
    it("should handle zero values correctly", () => {
      const clock = { "agent-1": 0 };
      const updated = incrementClock(clock, "agent-1");
      expect(updated["agent-1"]).toBe(1);
    });

    it("should handle missing agents as zero in happensBefore", () => {
      const a = { "agent-1": 1 };
      const b = { "agent-2": 1 };

      // Neither happens before the other (concurrent)
      expect(happensBefore(a, b)).toBe(false);
      expect(happensBefore(b, a)).toBe(false);
    });
  });

  describe("Transitivity", () => {
    it("should maintain transitivity: if A < B and B < C, then A < C", () => {
      const a = { "agent-1": 1 };
      const b = { "agent-1": 2 };
      const c = { "agent-1": 3 };

      expect(happensBefore(a, b)).toBe(true);
      expect(happensBefore(b, c)).toBe(true);
      expect(happensBefore(a, c)).toBe(true);
    });

    it("should maintain antisymmetry: if A < B, then NOT B < A", () => {
      const a = { "agent-1": 1 };
      const b = { "agent-1": 2 };

      expect(happensBefore(a, b)).toBe(true);
      expect(happensBefore(b, a)).toBe(false);
    });
  });

  describe("VectorClockManager Edge Cases", () => {
    it("should handle rapid ticks from multiple agents", () => {
      const manager = new VectorClockManager();

      for (let i = 0; i < 100; i++) {
        manager.tick(`agent-${i % 10}`);
      }

      const clock = manager.getClock();
      expect(Object.keys(clock)).toHaveLength(10);
      expect(clock["agent-0"]).toBe(10);
    });

    it("should handle receive with empty remote clock", () => {
      const manager = new VectorClockManager();
      manager.tick("agent-1");
      manager.receive("agent-1", {});

      expect(manager.getClock()["agent-1"]).toBe(2);
    });

    it("should handle receive with clock containing unknown agents", () => {
      const manager = new VectorClockManager();
      manager.tick("agent-1");
      manager.receive("agent-1", { "agent-999": 100 });

      const clock = manager.getClock();
      expect(clock["agent-1"]).toBe(2);
      expect(clock["agent-999"]).toBe(100);
    });

    it("should reset correctly after many operations", () => {
      const manager = new VectorClockManager();

      for (let i = 0; i < 100; i++) {
        manager.tick(`agent-${i}`);
      }

      manager.reset();
      expect(manager.getClock()).toEqual({});
    });
  });

  describe("Boundary Conditions", () => {
    it("should handle identical clocks in happensBefore", () => {
      const clock = { "agent-1": 5 };
      expect(happensBefore(clock, clock)).toBe(false);
    });

    it("should handle identical clocks in areConcurrent", () => {
      const clock = { "agent-1": 5 };
      expect(areConcurrent(clock, clock)).toBe(true);
    });

    it("should handle compareClock with identical clocks", () => {
      const clock = { "agent-1": 5 };
      expect(compareClock(clock, clock)).toBe(0);
    });
  });

  describe("Complex Scenarios", () => {
    it("should handle fork-join pattern correctly", () => {
      // Agent 1 forks to agents 2 and 3, then they join back
      const manager1 = new VectorClockManager();
      manager1.tick("agent-1");
      const forkClock = manager1.getClock();

      const manager2 = new VectorClockManager(forkClock);
      manager2.tick("agent-2");
      manager2.tick("agent-2");

      const manager3 = new VectorClockManager(forkClock);
      manager3.tick("agent-3");

      // Join: agent-1 receives from both
      manager1.receive("agent-1", manager2.getClock());
      manager1.receive("agent-1", manager3.getClock());

      const finalClock = manager1.getClock();
      expect(finalClock["agent-1"]).toBe(3); // Initial + 2 receives
      expect(finalClock["agent-2"]).toBe(2);
      expect(finalClock["agent-3"]).toBe(1);
    });

    it("should handle diamond pattern (A -> B, A -> C, B -> D, C -> D)", () => {
      const a = { "agent-1": 1 };
      const b = { "agent-1": 1, "agent-2": 1 };
      const c = { "agent-1": 1, "agent-3": 1 };
      const d = mergeClock(b, c);
      d["agent-4"] = 1;

      expect(happensBefore(a, b)).toBe(true);
      expect(happensBefore(a, c)).toBe(true);
      expect(happensBefore(b, d)).toBe(true);
      expect(happensBefore(c, d)).toBe(true);
      expect(happensBefore(a, d)).toBe(true);
    });
  });
});
