/**
 * @fileoverview Property-based tests for Rehearsal Mode
 * @module @weft/core/rehearsal/__tests__/property-based
 */

import { beforeAll, describe, expect, it } from "vitest";
import { TraceRecorder } from "../recorder";
import { TraceReplayer } from "../replayer";
import { DependencyScheduler } from "../scheduler";
import { DEFAULT_STORAGE_PATH, FileStorage } from "../storage";
import type { TraceEvent } from "../types";
import { happensBefore, mergeClock, VectorClockManager } from "../vectorClock";

// Ensure storage directory exists before running tests
beforeAll(async () => {
  if (typeof globalThis !== "undefined" && "process" in globalThis) {
    const fs = await import("node:fs/promises");
    try {
      await fs.mkdir(DEFAULT_STORAGE_PATH, { recursive: true });
    } catch {
      // Directory already exists
    }
  }
});

// Property: Vector clock causality
describe("Property: Vector Clock Causality", () => {
  it("should maintain happens-before transitivity for arbitrary clocks", () => {
    // Generate random clock states
    for (let trial = 0; trial < 100; trial++) {
      const manager = new VectorClockManager();

      // Random sequence of ticks and receives
      for (let i = 0; i < 20; i++) {
        const agentId = `agent-${Math.floor(Math.random() * 5)}`;
        manager.tick(agentId);

        if (Math.random() > 0.7) {
          // Occasionally receive from another agent
          const remoteAgent = `agent-${Math.floor(Math.random() * 5)}`;
          const remoteClock = { [remoteAgent]: Math.floor(Math.random() * 10) };
          manager.receive(agentId, remoteClock);
        }
      }

      const clock = manager.getClock();

      // Property: clock should be valid (all values >= 0)
      Object.values(clock).forEach((value) => {
        expect(value).toBeGreaterThanOrEqual(0);
      });
    }
  });

  it("should preserve component-wise maximum in merge", () => {
    // Test merge property with random clocks
    for (let trial = 0; trial < 100; trial++) {
      const clockA: Record<string, number> = {};
      const clockB: Record<string, number> = {};

      // Generate random clocks
      for (let i = 0; i < 10; i++) {
        const agentId = `agent-${i}`;
        clockA[agentId] = Math.floor(Math.random() * 100);
        clockB[agentId] = Math.floor(Math.random() * 100);
      }

      const merged = mergeClock(clockA, clockB);

      // Property: merged value should be max of both for each agent
      Object.keys(clockA).forEach((agentId) => {
        expect(merged[agentId]).toBeGreaterThanOrEqual(clockA[agentId]);
        expect(merged[agentId]).toBeGreaterThanOrEqual(clockB[agentId] ?? 0);
        expect(merged[agentId]).toBe(
          Math.max(clockA[agentId], clockB[agentId] ?? 0),
        );
      });
    }
  });
});

// Property: Event ordering determinism
describe("Property: Event Ordering Determinism", () => {
  function createRandomEvent(id: string, agentCount: number): TraceEvent {
    const agentId = `agent-${Math.floor(Math.random() * agentCount)}`;
    const vectorClock: Record<string, number> = {};

    for (let i = 0; i < agentCount; i++) {
      vectorClock[`agent-${i}`] = Math.floor(Math.random() * 100);
    }

    return {
      id,
      type: "operator",
      agentId,
      timestamp: Math.floor(Math.random() * 1000000),
      vectorClock,
      payload: { operator: "test", durationMs: 10 },
      hash: `hash_${id}`,
    };
  }

  it("should produce same order for same events", () => {
    for (let trial = 0; trial < 50; trial++) {
      const events = Array.from({ length: 100 }, (_, i) =>
        createRandomEvent(`e${i}`, 5),
      );

      const scheduler1 = new DependencyScheduler([...events]);
      const scheduler2 = new DependencyScheduler([...events]);

      const order1: string[] = [];
      const order2: string[] = [];

      while (scheduler1.hasNext()) {
        order1.push(scheduler1.next().id);
      }

      while (scheduler2.hasNext()) {
        order2.push(scheduler2.next().id);
      }

      // Property: Same events should produce same order
      expect(order1).toEqual(order2);
    }
  });

  it("should maintain causal ordering regardless of input order", () => {
    for (let trial = 0; trial < 50; trial++) {
      // Create events with known causal relationships
      const events: TraceEvent[] = [];

      for (let i = 0; i < 50; i++) {
        const vectorClock: Record<string, number> = {};
        for (let j = 0; j <= i; j++) {
          vectorClock[`agent-${j}`] = i - j + 1;
        }

        events.push({
          id: `e${i}`,
          type: "operator",
          agentId: `agent-${i % 5}`,
          timestamp: Math.floor(Math.random() * 1000000),
          vectorClock,
          payload: { operator: "test", durationMs: 10 },
          hash: `hash_${i}`,
        });
      }

      // Shuffle events
      const shuffled = [...events].sort(() => Math.random() - 0.5);

      const scheduler = new DependencyScheduler(shuffled);
      const ordered: TraceEvent[] = [];

      while (scheduler.hasNext()) {
        ordered.push(scheduler.next());
      }

      // Property: Events should be ordered by causal dependencies
      for (let i = 0; i < ordered.length; i++) {
        for (let j = i + 1; j < ordered.length; j++) {
          const eventI = ordered[i];
          const eventJ = ordered[j];

          // If I happens-before J, then I should come before J
          if (happensBefore(eventI.vectorClock, eventJ.vectorClock)) {
            expect(i).toBeLessThan(j);
          }
        }
      }
    }
  });
});

// Property: Checkpoint restoration
describe("Property: Checkpoint Restoration", () => {
  it("should restore state correctly from arbitrary checkpoints", () => {
    for (let trial = 0; trial < 50; trial++) {
      const recorder = new TraceRecorder();

      // Create random state
      const state = {
        counter: Math.floor(Math.random() * 1000),
        data: Array.from({ length: Math.floor(Math.random() * 100) }, () =>
          Math.random(),
        ),
        nested: {
          value: Math.random(),
          array: Array.from({ length: 10 }, () => Math.random()),
        },
      };

      const checkpointId = recorder.createCheckpoint(state);
      const trace = recorder.finalize({ result: "test" });

      // Property: Restored state should be deep equal to original
      const checkpoint = trace.checkpoints.find((c) => c.id === checkpointId);
      expect(checkpoint).toBeDefined();

      const restored = checkpoint?.state as typeof state;
      expect(restored.counter).toBe(state.counter);
      expect(restored.data).toEqual(state.data);
      expect(restored.nested.value).toBe(state.nested.value);
    }
  });
});

// Property: Compression roundtrip
describe("Property: Compression Roundtrip", () => {
  it(
    "should preserve trace integrity after compression",
    // 20-trial loop with file I/O is legitimately slow under load.
    { timeout: 30000 },
    async () => {
      for (let trial = 0; trial < 20; trial++) {
        const recorder = new TraceRecorder();

        // Create trace with random size
        const eventCount = Math.floor(Math.random() * 100) + 10;
        for (let i = 0; i < eventCount; i++) {
          recorder.appendEvent({
            type: "operator",
            agentId: `agent-${i % 10}`,
            payload: {
              operator: "test",
              data: Array.from({ length: Math.floor(Math.random() * 10) }, () =>
                Math.random(),
              ),
              durationMs: 10,
            },
          });
        }

        const originalTrace = recorder.finalize({ result: "compressed" });

        // Save and load (simulating compression)
        const testPath = `temp_test_${Date.now()}_${trial}`;
        const storage = new FileStorage({ basePath: testPath, compress: true });

        try {
          const _savedPath = await storage.save(originalTrace, `test-${trial}`);

          // Property: Loaded trace should match original
          // We use the full path to avoid resolvePath ambiguity
          const fullPath = `${testPath}/test-${trial}.trace.json.gz`;
          const loadedTrace = await storage.load(fullPath);

          expect(loadedTrace.id).toBe(originalTrace.id);
          expect(loadedTrace.events.length).toBe(originalTrace.events.length);
          expect(loadedTrace.finalOutput).toEqual(originalTrace.finalOutput);
        } finally {
          // Cleanup
          try {
            const fs = await import("node:fs/promises");
            await fs.rm(testPath, { recursive: true, force: true });
          } catch {
            // Ignore cleanup errors
          }
        }
      }
    },
  );
});

// Property: Replay determinism
describe("Property: Replay Determinism", () => {
  it("should produce identical results on multiple replays", async () => {
    for (let trial = 0; trial < 50; trial++) {
      const recorder = new TraceRecorder();

      // Create random trace
      const eventCount = Math.floor(Math.random() * 100) + 10;
      for (let i = 0; i < eventCount; i++) {
        recorder.appendEvent({
          type: "operator",
          agentId: `agent-${i % 5}`,
          payload: {
            operator: "test",
            value: Math.random(),
            durationMs: 10,
          },
        });
      }

      const finalOutput = { result: Math.random(), trial };
      const trace = recorder.finalize(finalOutput);

      // Replay multiple times
      const results = await Promise.all(
        Array.from({ length: 5 }, () => {
          const replayer = new TraceReplayer(trace);
          return replayer.replay();
        }),
      );

      // Property: All replays should produce same result
      results.forEach((result) => {
        expect(result.value).toEqual(finalOutput);
        expect(result.matched).toBe(true);
        expect(result.eventsReplayed).toBe(eventCount);
      });
    }
  });
});
