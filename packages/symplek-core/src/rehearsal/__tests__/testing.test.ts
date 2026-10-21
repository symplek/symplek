/**
 * @fileoverview Unit tests for Test Utilities
 * @module @symplek/core/rehearsal/__tests__/testing
 */

import { describe, expect, it } from "vitest";
import {
  assertDeterministic,
  assertEqual,
  createTestHarness,
  DeterminismError,
  deepEqual,
  diffPath,
  expectDeterministic,
  TestHarness,
} from "../testing";
import type { ExecutionTrace, RehearsalResult, ReplayResult } from "../types";
import { TRACE_SCHEMA_VERSION } from "../types";

describe("deepEqual", () => {
  describe("primitives", () => {
    it("should compare equal primitives", () => {
      expect(deepEqual(1, 1)).toBe(true);
      expect(deepEqual("hello", "hello")).toBe(true);
      expect(deepEqual(true, true)).toBe(true);
      expect(deepEqual(null, null)).toBe(true);
      expect(deepEqual(undefined, undefined)).toBe(true);
    });

    it("should detect unequal primitives", () => {
      expect(deepEqual(1, 2)).toBe(false);
      expect(deepEqual("hello", "world")).toBe(false);
      expect(deepEqual(true, false)).toBe(false);
      expect(deepEqual(null, undefined)).toBe(false);
    });

    it("should handle type mismatches", () => {
      expect(deepEqual(1, "1")).toBe(false);
      expect(deepEqual(true, 1)).toBe(false);
      expect(deepEqual({}, null)).toBe(false);
    });
  });

  describe("arrays", () => {
    it("should compare equal arrays", () => {
      expect(deepEqual([1, 2, 3], [1, 2, 3])).toBe(true);
      expect(deepEqual([], [])).toBe(true);
      expect(deepEqual([[1], [2]], [[1], [2]])).toBe(true);
    });

    it("should detect unequal arrays", () => {
      expect(deepEqual([1, 2], [1, 2, 3])).toBe(false);
      expect(deepEqual([1, 2, 3], [3, 2, 1])).toBe(false);
    });
  });

  describe("objects", () => {
    it("should compare equal objects", () => {
      expect(deepEqual({ a: 1 }, { a: 1 })).toBe(true);
      expect(deepEqual({ a: { b: 2 } }, { a: { b: 2 } })).toBe(true);
      expect(deepEqual({}, {})).toBe(true);
    });

    it("should detect unequal objects", () => {
      expect(deepEqual({ a: 1 }, { a: 2 })).toBe(false);
      expect(deepEqual({ a: 1 }, { b: 1 })).toBe(false);
      expect(deepEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false);
    });
  });

  describe("options", () => {
    it("should ignore specified keys", () => {
      const a = { x: 1, y: 2, z: 3 };
      const b = { x: 1, y: 999, z: 3 };

      expect(deepEqual(a, b, { ignoreKeys: ["y"] })).toBe(true);
      expect(deepEqual(a, b)).toBe(false);
    });

    it("should use tolerance for numbers", () => {
      expect(deepEqual(1.0, 1.0001, { tolerance: 0.001 })).toBe(true);
      expect(deepEqual(1.0, 1.0001, { tolerance: 0.00001 })).toBe(false);
    });

    it("should compare functions by reference when configured", () => {
      const fn1 = () => {};
      const fn2 = () => {};

      // By default, functions are ignored
      expect(deepEqual({ fn: fn1 }, { fn: fn2 })).toBe(true);

      // With compareFunctions, they're compared by reference
      expect(
        deepEqual({ fn: fn1 }, { fn: fn2 }, { compareFunctions: true }),
      ).toBe(false);
      expect(
        deepEqual({ fn: fn1 }, { fn: fn1 }, { compareFunctions: true }),
      ).toBe(true);
    });
  });

  describe("same reference", () => {
    it("should return true for same reference", () => {
      const obj = { a: 1 };
      expect(deepEqual(obj, obj)).toBe(true);
    });
  });
});

describe("diffPath", () => {
  it("should return empty for equal values", () => {
    expect(diffPath({ a: 1 }, { a: 1 })).toEqual([]);
  });

  it("should report type mismatches", () => {
    const diffs = diffPath(1, "1");
    expect(diffs).toHaveLength(1);
    expect(diffs[0]).toContain("type mismatch");
  });

  it("should report value differences", () => {
    const diffs = diffPath({ a: 1 }, { a: 2 });
    expect(diffs).toHaveLength(1);
    expect(diffs[0]).toContain("$.a");
  });

  it("should report array length differences", () => {
    const diffs = diffPath([1, 2], [1, 2, 3]);
    expect(diffs.some((d) => d.includes("length mismatch"))).toBe(true);
  });

  it("should report missing keys", () => {
    const diffs = diffPath({ a: 1 }, { a: 1, b: 2 });
    expect(diffs.some((d) => d.includes("missing"))).toBe(true);
  });

  it("should track nested paths", () => {
    const diffs = diffPath({ x: { y: { z: 1 } } }, { x: { y: { z: 2 } } });
    expect(diffs[0]).toContain("$.x.y.z");
  });
});

describe("DeterminismError", () => {
  it("should have name and differences", () => {
    const error = new DeterminismError("Test error", ["diff1", "diff2"]);

    expect(error.name).toBe("DeterminismError");
    expect(error.message).toBe("Test error");
    expect(error.differences).toEqual(["diff1", "diff2"]);
  });
});

describe("assertDeterministic", () => {
  // Helper to create mock results
  function createRehearsalResult<T>(value: T): RehearsalResult<T> {
    return {
      value,
      trace: {
        id: "trace_test",
        version: TRACE_SCHEMA_VERSION,
        startTime: Date.now() - 1000,
        endTime: Date.now(),
        events: [],
        checkpoints: [],
        metadata: {
          composition: "test",
          agentCount: 1,
          eventCount: 0,
          durationMs: 1000,
          schemaVersion: TRACE_SCHEMA_VERSION,
          operatorChain: [],
          includesPrompts: false,
          checkpointCount: 0,
        },
        finalOutput: value,
      },
    };
  }

  function createReplayResult<T>(
    value: T,
    matched: boolean,
    divergences: Array<{
      severity: "critical" | "warning" | "info";
      description: string;
    }> = [],
  ): ReplayResult<T> {
    return {
      value,
      matched,
      divergences: divergences.map((d) => ({
        eventId: "e1",
        expected: "expected",
        actual: "actual",
        ...d,
      })),
      eventsReplayed: 0,
      totalEvents: 0,
    };
  }

  it("should pass for matching results", () => {
    const original = createRehearsalResult({ counter: 42 });
    const replayed = createReplayResult({ counter: 42 }, true);

    expect(() => assertDeterministic(original, replayed)).not.toThrow();
  });

  it("should throw for critical divergences", () => {
    const original = createRehearsalResult({ value: 1 });
    const replayed = createReplayResult({ value: 1 }, false, [
      { severity: "critical", description: "Critical error" },
    ]);

    expect(() => assertDeterministic(original, replayed)).toThrow(
      DeterminismError,
    );
  });

  it("should pass with only warning divergences", () => {
    const original = createRehearsalResult({ value: 1 });
    const replayed = createReplayResult({ value: 1 }, true, [
      { severity: "warning", description: "Minor warning" },
    ]);

    expect(() => assertDeterministic(original, replayed)).not.toThrow();
  });

  it("should throw for value differences", () => {
    const original = createRehearsalResult({ counter: 42 });
    const replayed = createReplayResult({ counter: 99 }, true);

    expect(() => assertDeterministic(original, replayed)).toThrow(
      DeterminismError,
    );
  });

  it("should apply comparison options", () => {
    const original = createRehearsalResult({ a: 1, b: 2 });
    const replayed = createReplayResult({ a: 1, b: 999 }, true);

    // Should throw without options
    expect(() => assertDeterministic(original, replayed)).toThrow();

    // Should pass with ignoreKeys
    expect(() =>
      assertDeterministic(original, replayed, { ignoreKeys: ["b"] }),
    ).not.toThrow();
  });
});

describe("assertEqual", () => {
  it("should pass for equal values", () => {
    expect(() => assertEqual({ a: 1 }, { a: 1 })).not.toThrow();
  });

  it("should throw for unequal values", () => {
    expect(() => assertEqual({ a: 1 }, { a: 2 })).toThrow();
  });

  it("should include custom message", () => {
    expect(() => assertEqual(1, 2, "Custom message")).toThrow("Custom message");
  });

  it("should include diff details", () => {
    expect(() => assertEqual({ a: 1 }, { a: 2 })).toThrow(/\$\.a/);
  });
});

describe("TestHarness", () => {
  describe("constructor", () => {
    it("should create with default config", () => {
      const harness = new TestHarness();
      expect(harness).toBeDefined();
    });

    it("should accept custom config", () => {
      const harness = new TestHarness({
        traceDir: "custom/__traces__",
        autoSave: true,
        compareOptions: { tolerance: 0.001 },
      });
      expect(harness).toBeDefined();
    });
  });

  describe("record", () => {
    it("should record and store trace", async () => {
      const harness = new TestHarness();

      const result = await harness.record(async () => ({
        value: "result",
        trace: {
          id: "test_trace",
          version: TRACE_SCHEMA_VERSION,
          startTime: Date.now(),
          endTime: Date.now(),
          events: [],
          checkpoints: [],
          metadata: {
            composition: "test",
            agentCount: 1,
            eventCount: 0,
            durationMs: 0,
            schemaVersion: TRACE_SCHEMA_VERSION,
            operatorChain: [],
            includesPrompts: false,
            checkpointCount: 0,
          },
          finalOutput: "result",
        },
      }));

      expect(result.value).toBe("result");
      expect(harness.getTrace("test_trace")).toBeDefined();
    });

    it("should use custom name if provided", async () => {
      const harness = new TestHarness();

      await harness.record(
        async () => ({
          value: "result",
          trace: {
            id: "original_id",
            version: TRACE_SCHEMA_VERSION,
            startTime: Date.now(),
            endTime: Date.now(),
            events: [],
            checkpoints: [],
            metadata: {
              composition: "test",
              agentCount: 1,
              eventCount: 0,
              durationMs: 0,
              schemaVersion: TRACE_SCHEMA_VERSION,
              operatorChain: [],
              includesPrompts: false,
              checkpointCount: 0,
            },
            finalOutput: "result",
          },
        }),
        "custom_name",
      );

      expect(harness.getTrace("custom_name")).toBeDefined();
    });
  });

  describe("replay", () => {
    it("should replay trace", async () => {
      const harness = new TestHarness();

      const trace: ExecutionTrace<string> = {
        id: "test",
        version: TRACE_SCHEMA_VERSION,
        startTime: Date.now(),
        endTime: Date.now(),
        events: [],
        checkpoints: [],
        metadata: {
          composition: "test",
          agentCount: 1,
          eventCount: 0,
          durationMs: 0,
          schemaVersion: TRACE_SCHEMA_VERSION,
          operatorChain: [],
          includesPrompts: false,
          checkpointCount: 0,
        },
        finalOutput: "result",
      };

      const result = await harness.replay(trace);
      expect(result.value).toBe("result");
      expect(result.matched).toBe(true);
    });
  });

  describe("getTrace / clear", () => {
    it("should get stored trace", async () => {
      const harness = new TestHarness();

      await harness.record(async () => ({
        value: "x",
        trace: {
          id: "my_trace",
          version: TRACE_SCHEMA_VERSION,
          startTime: Date.now(),
          endTime: Date.now(),
          events: [],
          checkpoints: [],
          metadata: {
            composition: "test",
            agentCount: 1,
            eventCount: 0,
            durationMs: 0,
            schemaVersion: TRACE_SCHEMA_VERSION,
            operatorChain: [],
            includesPrompts: false,
            checkpointCount: 0,
          },
          finalOutput: "x",
        },
      }));

      expect(harness.getTrace("my_trace")).toBeDefined();
    });

    it("should return undefined for unknown trace", () => {
      const harness = new TestHarness();
      expect(harness.getTrace("unknown")).toBeUndefined();
    });

    it("should clear all traces", async () => {
      const harness = new TestHarness();

      await harness.record(async () => ({
        value: "x",
        trace: {
          id: "trace1",
          version: TRACE_SCHEMA_VERSION,
          startTime: Date.now(),
          endTime: Date.now(),
          events: [],
          checkpoints: [],
          metadata: {
            composition: "test",
            agentCount: 1,
            eventCount: 0,
            durationMs: 0,
            schemaVersion: TRACE_SCHEMA_VERSION,
            operatorChain: [],
            includesPrompts: false,
            checkpointCount: 0,
          },
          finalOutput: "x",
        },
      }));

      harness.clear();
      expect(harness.getTrace("trace1")).toBeUndefined();
    });
  });
});

describe("createTestHarness", () => {
  it("should create TestHarness instance", () => {
    const harness = createTestHarness();
    expect(harness).toBeInstanceOf(TestHarness);
  });

  it("should pass config to TestHarness", () => {
    const harness = createTestHarness({ traceDir: "custom" });
    expect(harness).toBeDefined();
  });
});

describe("expectDeterministic", () => {
  it("should pass for matched result", () => {
    const result: ReplayResult<string> = {
      value: "test",
      matched: true,
      divergences: [],
      eventsReplayed: 5,
      totalEvents: 5,
    };

    const matcher = expectDeterministic(result);
    expect(matcher.pass).toBe(true);
  });

  it("should fail for unmatched result", () => {
    const result: ReplayResult<string> = {
      value: "test",
      matched: false,
      divergences: [
        {
          eventId: "e1",
          expected: "x",
          actual: "y",
          severity: "critical",
          description: "Critical failure",
        },
      ],
      eventsReplayed: 3,
      totalEvents: 5,
    };

    const matcher = expectDeterministic(result);
    expect(matcher.pass).toBe(false);
    expect(matcher.message()).toContain("divergence");
  });

  it("should fail for critical divergences even if matched", () => {
    const result: ReplayResult<string> = {
      value: "test",
      matched: true,
      divergences: [
        {
          eventId: "e1",
          expected: "x",
          actual: "y",
          severity: "critical",
          description: "Critical issue",
        },
      ],
      eventsReplayed: 5,
      totalEvents: 5,
    };

    const matcher = expectDeterministic(result);
    expect(matcher.pass).toBe(false);
  });

  it("should pass with only warning divergences", () => {
    const result: ReplayResult<string> = {
      value: "test",
      matched: true,
      divergences: [
        {
          eventId: "e1",
          expected: "x",
          actual: "y",
          severity: "warning",
          description: "Minor warning",
        },
      ],
      eventsReplayed: 5,
      totalEvents: 5,
    };

    const matcher = expectDeterministic(result);
    expect(matcher.pass).toBe(true);
  });
});
