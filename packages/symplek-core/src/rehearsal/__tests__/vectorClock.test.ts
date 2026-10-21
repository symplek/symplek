/**
 * @fileoverview Unit tests for Vector Clock operations
 * @module @symplek/core/rehearsal/__tests__/vectorClock
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

describe("vectorClock", () => {
  describe("createVectorClock", () => {
    it("should create an empty vector clock", () => {
      const clock = createVectorClock();
      expect(clock).toEqual({});
      expect(Object.keys(clock)).toHaveLength(0);
    });
  });

  describe("incrementClock", () => {
    it("should increment clock for new agent", () => {
      const clock = createVectorClock();
      const updated = incrementClock(clock, "agent-1");
      expect(updated).toEqual({ "agent-1": 1 });
    });

    it("should increment clock for existing agent", () => {
      const clock = { "agent-1": 5 };
      const updated = incrementClock(clock, "agent-1");
      expect(updated).toEqual({ "agent-1": 6 });
    });

    it("should not modify original clock", () => {
      const clock = { "agent-1": 1 };
      incrementClock(clock, "agent-1");
      expect(clock).toEqual({ "agent-1": 1 });
    });

    it("should handle multiple agents", () => {
      let clock = createVectorClock();
      clock = incrementClock(clock, "agent-1");
      clock = incrementClock(clock, "agent-2");
      clock = incrementClock(clock, "agent-1");
      expect(clock).toEqual({ "agent-1": 2, "agent-2": 1 });
    });
  });

  describe("mergeClock", () => {
    it("should merge empty clocks", () => {
      const result = mergeClock({}, {});
      expect(result).toEqual({});
    });

    it("should merge with empty clock", () => {
      const a = { "agent-1": 3 };
      expect(mergeClock(a, {})).toEqual({ "agent-1": 3 });
      expect(mergeClock({}, a)).toEqual({ "agent-1": 3 });
    });

    it("should take component-wise maximum", () => {
      const a = { "agent-1": 3, "agent-2": 1 };
      const b = { "agent-1": 1, "agent-2": 5 };
      const result = mergeClock(a, b);
      expect(result).toEqual({ "agent-1": 3, "agent-2": 5 });
    });

    it("should include agents only in one clock", () => {
      const a = { "agent-1": 2 };
      const b = { "agent-2": 3 };
      const result = mergeClock(a, b);
      expect(result).toEqual({ "agent-1": 2, "agent-2": 3 });
    });

    it("should not modify original clocks", () => {
      const a = { "agent-1": 1 };
      const b = { "agent-2": 2 };
      mergeClock(a, b);
      expect(a).toEqual({ "agent-1": 1 });
      expect(b).toEqual({ "agent-2": 2 });
    });
  });

  describe("happensBefore", () => {
    it("should return false for empty clocks", () => {
      expect(happensBefore({}, {})).toBe(false);
    });

    it("should return true when a clearly happens before b", () => {
      const a = { "agent-1": 1, "agent-2": 0 };
      const b = { "agent-1": 2, "agent-2": 1 };
      expect(happensBefore(a, b)).toBe(true);
    });

    it("should return false when b happens before a", () => {
      const a = { "agent-1": 2, "agent-2": 1 };
      const b = { "agent-1": 1, "agent-2": 0 };
      expect(happensBefore(a, b)).toBe(false);
    });

    it("should return false for identical clocks", () => {
      const a = { "agent-1": 2, "agent-2": 3 };
      const b = { "agent-1": 2, "agent-2": 3 };
      expect(happensBefore(a, b)).toBe(false);
    });

    it("should return false for concurrent clocks", () => {
      const a = { "agent-1": 2, "agent-2": 0 };
      const b = { "agent-1": 0, "agent-2": 2 };
      expect(happensBefore(a, b)).toBe(false);
      expect(happensBefore(b, a)).toBe(false);
    });

    it("should handle missing agents", () => {
      const a = { "agent-1": 1 };
      const b = { "agent-1": 2, "agent-2": 1 };
      expect(happensBefore(a, b)).toBe(true);
    });
  });

  describe("areConcurrent", () => {
    it("should return true for concurrent clocks", () => {
      const a = { "agent-1": 2, "agent-2": 0 };
      const b = { "agent-1": 0, "agent-2": 2 };
      expect(areConcurrent(a, b)).toBe(true);
    });

    it("should return false when one happens before other", () => {
      const a = { "agent-1": 1 };
      const b = { "agent-1": 2 };
      expect(areConcurrent(a, b)).toBe(false);
    });

    it("should return true for identical non-empty clocks", () => {
      const a = { "agent-1": 2 };
      const b = { "agent-1": 2 };
      expect(areConcurrent(a, b)).toBe(true);
    });
  });

  describe("compareClock", () => {
    it("should return -1 when a < b", () => {
      const a = { "agent-1": 1 };
      const b = { "agent-1": 2 };
      expect(compareClock(a, b)).toBe(-1);
    });

    it("should return 1 when a > b", () => {
      const a = { "agent-1": 2 };
      const b = { "agent-1": 1 };
      expect(compareClock(a, b)).toBe(1);
    });

    it("should return 0 for concurrent clocks", () => {
      const a = { "agent-1": 2, "agent-2": 0 };
      const b = { "agent-1": 0, "agent-2": 2 };
      expect(compareClock(a, b)).toBe(0);
    });
  });
});

describe("VectorClockManager", () => {
  it("should start with empty clock", () => {
    const manager = new VectorClockManager();
    expect(manager.getClock()).toEqual({});
  });

  it("should accept initial clock", () => {
    const initial = { "agent-1": 5 };
    const manager = new VectorClockManager(initial);
    expect(manager.getClock()).toEqual({ "agent-1": 5 });
  });

  describe("tick", () => {
    it("should increment for agent", () => {
      const manager = new VectorClockManager();
      manager.tick("agent-1");
      expect(manager.getClock()).toEqual({ "agent-1": 1 });
      manager.tick("agent-1");
      expect(manager.getClock()).toEqual({ "agent-1": 2 });
    });
  });

  describe("receive", () => {
    it("should merge and increment", () => {
      const manager = new VectorClockManager();
      manager.tick("agent-1");

      const remoteClock = { "agent-2": 3 };
      manager.receive("agent-1", remoteClock);

      const clock = manager.getClock();
      expect(clock["agent-1"]).toBe(2); // incremented after merge
      expect(clock["agent-2"]).toBe(3); // merged from remote
    });
  });

  describe("reset", () => {
    it("should reset to empty clock", () => {
      const manager = new VectorClockManager();
      manager.tick("agent-1");
      manager.tick("agent-2");
      manager.reset();
      expect(manager.getClock()).toEqual({});
    });
  });

  describe("getClock", () => {
    it("should return immutable copy", () => {
      const manager = new VectorClockManager();
      manager.tick("agent-1");

      const clock1 = manager.getClock();
      const clock2 = manager.getClock();

      expect(clock1).not.toBe(clock2);
      expect(clock1).toEqual(clock2);
    });
  });

  describe("static methods", () => {
    it("happensBefore should work", () => {
      const a = { "agent-1": 1 };
      const b = { "agent-1": 2 };
      expect(VectorClockManager.happensBefore(a, b)).toBe(true);
    });

    it("areConcurrent should work", () => {
      const a = { "agent-1": 2, "agent-2": 0 };
      const b = { "agent-1": 0, "agent-2": 2 };
      expect(VectorClockManager.areConcurrent(a, b)).toBe(true);
    });
  });
});
