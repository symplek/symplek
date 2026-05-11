/**
 * @fileoverview Unit tests for Checkpoint Manager
 * @module @weft/core/rehearsal/__tests__/checkpoint
 */

import { describe, expect, it } from "vitest";
import {
  CheckpointManager,
  createCheckpoint,
  restoreFromCheckpoint,
} from "../checkpoint";
import type { Checkpoint, ExecutionTrace } from "../types";
import { TRACE_SCHEMA_VERSION } from "../types";

// Helper to create checkpoint
function makeCheckpoint(
  id: string,
  eventIndex: number,
  state: unknown = { value: eventIndex },
): Checkpoint {
  const serializedState = JSON.parse(JSON.stringify(state));
  return {
    id,
    vectorClock: { "agent-1": eventIndex },
    state: serializedState,
    timestamp: Date.now(),
    stateHash: computeHash(serializedState),
    eventIndex,
  };
}

// Simple hash function for testing
function computeHash(state: unknown): string {
  const content = JSON.stringify(state);
  let hash = 5381;
  for (let i = 0; i < content.length; i++) {
    hash = (hash * 33) ^ content.charCodeAt(i);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

// Helper to create minimal trace
function createTrace(checkpoints: Checkpoint[] = []): ExecutionTrace {
  return {
    id: "trace_test",
    version: TRACE_SCHEMA_VERSION,
    startTime: Date.now() - 1000,
    endTime: Date.now(),
    events: [],
    checkpoints,
    metadata: {
      composition: "test",
      agentCount: 1,
      eventCount: 0,
      durationMs: 1000,
      schemaVersion: TRACE_SCHEMA_VERSION,
      operatorChain: [],
      includesPrompts: false,
      checkpointCount: checkpoints.length,
    },
    finalOutput: "result",
  };
}

describe("CheckpointManager", () => {
  describe("constructor", () => {
    it("should create from trace with no checkpoints", () => {
      const trace = createTrace([]);
      const manager = new CheckpointManager(trace);
      expect(manager.getCheckpointCount()).toBe(0);
    });

    it("should create from trace with checkpoints", () => {
      const checkpoints = [
        makeCheckpoint("chk1", 0),
        makeCheckpoint("chk2", 10),
      ];
      const trace = createTrace(checkpoints);
      const manager = new CheckpointManager(trace);
      expect(manager.getCheckpointCount()).toBe(2);
    });
  });

  describe("getAllCheckpoints", () => {
    it("should return all checkpoints", () => {
      const checkpoints = [
        makeCheckpoint("chk1", 0),
        makeCheckpoint("chk2", 10),
        makeCheckpoint("chk3", 20),
      ];
      const trace = createTrace(checkpoints);
      const manager = new CheckpointManager(trace);

      const all = manager.getAllCheckpoints();
      expect(all).toHaveLength(3);
      expect(all[0].id).toBe("chk1");
      expect(all[1].id).toBe("chk2");
      expect(all[2].id).toBe("chk3");
    });
  });

  describe("getCheckpointById", () => {
    it("should find checkpoint by ID", () => {
      const checkpoints = [
        makeCheckpoint("chk1", 0),
        makeCheckpoint("chk2", 10),
      ];
      const trace = createTrace(checkpoints);
      const manager = new CheckpointManager(trace);

      const found = manager.getCheckpointById("chk2");
      expect(found).toBeDefined();
      expect(found?.id).toBe("chk2");
      expect(found?.eventIndex).toBe(10);
    });

    it("should return undefined for unknown ID", () => {
      const trace = createTrace([makeCheckpoint("chk1", 0)]);
      const manager = new CheckpointManager(trace);

      const found = manager.getCheckpointById("unknown");
      expect(found).toBeUndefined();
    });
  });

  describe("getCheckpointAtIndex", () => {
    it("should find checkpoint at event index", () => {
      const checkpoints = [
        makeCheckpoint("chk1", 0),
        makeCheckpoint("chk2", 10),
        makeCheckpoint("chk3", 20),
      ];
      const trace = createTrace(checkpoints);
      const manager = new CheckpointManager(trace);

      const found = manager.getCheckpointAtIndex(10);
      expect(found?.id).toBe("chk2");
    });

    it("should return undefined for index without checkpoint", () => {
      const checkpoints = [
        makeCheckpoint("chk1", 0),
        makeCheckpoint("chk2", 10),
      ];
      const trace = createTrace(checkpoints);
      const manager = new CheckpointManager(trace);

      const found = manager.getCheckpointAtIndex(5);
      expect(found).toBeUndefined();
    });
  });

  describe("getNearestCheckpointBefore", () => {
    it("should find nearest checkpoint before index", () => {
      const checkpoints = [
        makeCheckpoint("chk1", 0),
        makeCheckpoint("chk2", 10),
        makeCheckpoint("chk3", 20),
      ];
      const trace = createTrace(checkpoints);
      const manager = new CheckpointManager(trace);

      // Event 15 - nearest before is chk2 at index 10
      const found = manager.getNearestCheckpointBefore(15);
      expect(found?.id).toBe("chk2");
    });

    it("should return checkpoint at exact index", () => {
      const checkpoints = [
        makeCheckpoint("chk1", 0),
        makeCheckpoint("chk2", 10),
      ];
      const trace = createTrace(checkpoints);
      const manager = new CheckpointManager(trace);

      const found = manager.getNearestCheckpointBefore(10);
      expect(found?.id).toBe("chk2");
    });

    it("should return undefined if no checkpoint before index", () => {
      const checkpoints = [makeCheckpoint("chk1", 10)];
      const trace = createTrace(checkpoints);
      const manager = new CheckpointManager(trace);

      const found = manager.getNearestCheckpointBefore(5);
      expect(found).toBeUndefined();
    });

    it("should handle empty checkpoints", () => {
      const trace = createTrace([]);
      const manager = new CheckpointManager(trace);

      const found = manager.getNearestCheckpointBefore(10);
      expect(found).toBeUndefined();
    });
  });

  describe("getCheckpointsInRange", () => {
    it("should return checkpoints in range", () => {
      const checkpoints = [
        makeCheckpoint("chk1", 0),
        makeCheckpoint("chk2", 10),
        makeCheckpoint("chk3", 20),
        makeCheckpoint("chk4", 30),
      ];
      const trace = createTrace(checkpoints);
      const manager = new CheckpointManager(trace);

      const inRange = manager.getCheckpointsInRange(5, 25);
      expect(inRange).toHaveLength(2);
      expect(inRange[0].id).toBe("chk2");
      expect(inRange[1].id).toBe("chk3");
    });

    it("should include boundary checkpoints", () => {
      const checkpoints = [
        makeCheckpoint("chk1", 10),
        makeCheckpoint("chk2", 20),
      ];
      const trace = createTrace(checkpoints);
      const manager = new CheckpointManager(trace);

      const inRange = manager.getCheckpointsInRange(10, 20);
      expect(inRange).toHaveLength(2);
    });

    it("should return empty for range with no checkpoints", () => {
      const checkpoints = [
        makeCheckpoint("chk1", 0),
        makeCheckpoint("chk2", 100),
      ];
      const trace = createTrace(checkpoints);
      const manager = new CheckpointManager(trace);

      const inRange = manager.getCheckpointsInRange(10, 90);
      expect(inRange).toHaveLength(0);
    });
  });

  describe("restoreState", () => {
    it("should restore state from checkpoint", () => {
      const state = { counter: 42, data: [1, 2, 3] };
      const checkpoint = makeCheckpoint("chk1", 0, state);
      const trace = createTrace([checkpoint]);
      const manager = new CheckpointManager(trace);

      const restored = manager.restoreState<typeof state>(checkpoint);
      expect(restored.counter).toBe(42);
      expect(restored.data).toEqual([1, 2, 3]);
    });

    it("should return deep clone", () => {
      const state = { nested: { value: 1 } };
      const checkpoint = makeCheckpoint("chk1", 0, state);
      const trace = createTrace([checkpoint]);
      const manager = new CheckpointManager(trace);

      const restored1 = manager.restoreState<typeof state>(checkpoint);
      const restored2 = manager.restoreState<typeof state>(checkpoint);

      expect(restored1).not.toBe(restored2);
      expect(restored1.nested).not.toBe(restored2.nested);
    });
  });

  describe("verifyCheckpoint", () => {
    it("should verify valid checkpoint", () => {
      const state = { value: 42 };
      const checkpoint = makeCheckpoint("chk1", 0, state);
      const trace = createTrace([checkpoint]);
      const manager = new CheckpointManager(trace);

      expect(manager.verifyCheckpoint(checkpoint)).toBe(true);
    });

    it("should reject checkpoint with wrong hash", () => {
      const checkpoint = makeCheckpoint("chk1", 0, { value: 42 });
      // Tamper with the hash
      const tamperedCheckpoint = {
        ...checkpoint,
        stateHash: "00000000",
      };
      const trace = createTrace([tamperedCheckpoint]);
      const manager = new CheckpointManager(trace);

      expect(manager.verifyCheckpoint(tamperedCheckpoint)).toBe(false);
    });
  });

  describe("hasCheckpoints", () => {
    it("should return true if checkpoints exist", () => {
      const trace = createTrace([makeCheckpoint("chk1", 0)]);
      const manager = new CheckpointManager(trace);
      expect(manager.hasCheckpoints()).toBe(true);
    });

    it("should return false if no checkpoints", () => {
      const trace = createTrace([]);
      const manager = new CheckpointManager(trace);
      expect(manager.hasCheckpoints()).toBe(false);
    });
  });
});

describe("createCheckpoint", () => {
  it("should create checkpoint with state", () => {
    const state = { counter: 42 };
    const vectorClock = { "agent-1": 5 };

    const checkpoint = createCheckpoint(state, vectorClock, 10);

    expect(checkpoint.id).toMatch(/^chk_/);
    expect(checkpoint.state).toEqual({ counter: 42 });
    expect(checkpoint.vectorClock).toEqual({ "agent-1": 5 });
    expect(checkpoint.eventIndex).toBe(10);
    expect(checkpoint.stateHash).toBeDefined();
    expect(checkpoint.timestamp).toBeLessThanOrEqual(Date.now());
  });

  it("should deep clone state", () => {
    const state = { nested: { value: 1 } };
    const checkpoint = createCheckpoint(state, {}, 0);

    // Modify original
    state.nested.value = 999;

    expect((checkpoint.state as typeof state).nested.value).toBe(1);
  });

  it("should copy vector clock", () => {
    const vectorClock = { "agent-1": 5 };
    const checkpoint = createCheckpoint({}, vectorClock, 0);

    // Modify original
    vectorClock["agent-1"] = 999;

    expect(checkpoint.vectorClock["agent-1"]).toBe(5);
  });
});

describe("restoreFromCheckpoint", () => {
  it("should restore state from checkpoint", () => {
    const state = { counter: 42, data: [1, 2, 3] };
    const checkpoint = makeCheckpoint("chk1", 0, state);

    const restored = restoreFromCheckpoint<typeof state>(checkpoint);
    expect(restored).toEqual(state);
  });

  it("should return deep clone", () => {
    const state = { nested: { value: 1 } };
    const checkpoint = makeCheckpoint("chk1", 0, state);

    const restored = restoreFromCheckpoint<typeof state>(checkpoint);
    expect(restored).not.toBe(checkpoint.state);
    expect(restored.nested).not.toBe((checkpoint.state as typeof state).nested);
  });
});
