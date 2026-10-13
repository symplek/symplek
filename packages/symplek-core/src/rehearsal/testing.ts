/**
 * @fileoverview Test utilities for Rehearsal Mode
 * @description Test harness, assertions, and deep equality for deterministic testing
 * @module @symplek/core/rehearsal/testing
 * @since 1.0.0
 *
 * 📝 BUILD[04.04]: Test Harness Factory
 * 📝 BUILD[04.05]: Assert Deterministic
 * 📝 BUILD[04.06]: Deep Equal Utility
 */

import { TraceReplayer } from "./replayer";
import type {
  ExecutionTrace,
  RehearsalResult,
  ReplayerOptions,
  ReplayResult,
} from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// DEEP EQUALITY
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Options for deep equality comparison.
 */
export interface DeepEqualOptions {
  /** Ignore specific keys in objects */
  ignoreKeys?: string[];
  /** Allow numeric tolerance for floating point comparison */
  tolerance?: number;
  /** Compare functions by reference */
  compareFunctions?: boolean;
}

/**
 * Deep equality comparison with options.
 *
 * @param a - First value
 * @param b - Second value
 * @param options - Comparison options
 * @returns true if deeply equal
 *
 * @example
 * ```typescript
 * const a = { x: 1, y: [2, 3], z: { nested: true } };
 * const b = { x: 1, y: [2, 3], z: { nested: true } };
 *
 * deepEqual(a, b); // true
 * deepEqual(a, b, { ignoreKeys: ['z'] }); // true even if z differs
 * ```
 */
export function deepEqual(
  a: unknown,
  b: unknown,
  options: DeepEqualOptions = {},
): boolean {
  // Same reference
  if (a === b) return true;

  // Null/undefined checks
  if (a === null || b === null) return a === b;
  if (a === undefined || b === undefined) return a === b;

  // Type mismatch
  if (typeof a !== typeof b) return false;

  // Primitives
  if (typeof a !== "object") {
    // Numeric tolerance
    if (typeof a === "number" && typeof b === "number" && options.tolerance) {
      return Math.abs(a - b) <= options.tolerance;
    }
    // Function comparison
    if (typeof a === "function" && typeof b === "function") {
      return options.compareFunctions ? a === b : true; // Ignore functions by default
    }
    return a === b;
  }

  // Arrays
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!deepEqual(a[i], b[i], options)) return false;
    }
    return true;
  }

  // Objects
  if (Array.isArray(a) !== Array.isArray(b)) return false;

  const objA = a as Record<string, unknown>;
  const objB = b as Record<string, unknown>;

  const keysA = Object.keys(objA).filter(
    (k) => !options.ignoreKeys?.includes(k),
  );
  const keysB = Object.keys(objB).filter(
    (k) => !options.ignoreKeys?.includes(k),
  );

  if (keysA.length !== keysB.length) return false;

  for (const key of keysA) {
    if (!keysB.includes(key)) return false;
    if (!deepEqual(objA[key], objB[key], options)) return false;
  }

  return true;
}

/**
 * Get the difference path between two values.
 *
 * @param a - First value
 * @param b - Second value
 * @param path - Current path (for recursion)
 * @returns Array of difference descriptions
 */
export function diffPath(a: unknown, b: unknown, path: string = "$"): string[] {
  const diffs: string[] = [];

  if (a === b) return diffs;

  if (typeof a !== typeof b) {
    diffs.push(`${path}: type mismatch (${typeof a} vs ${typeof b})`);
    return diffs;
  }

  if (typeof a !== "object" || a === null || b === null) {
    if (a !== b) {
      diffs.push(`${path}: ${JSON.stringify(a)} !== ${JSON.stringify(b)}`);
    }
    return diffs;
  }

  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) {
      diffs.push(`${path}: array length mismatch (${a.length} vs ${b.length})`);
    }
    const minLen = Math.min(a.length, b.length);
    for (let i = 0; i < minLen; i++) {
      diffs.push(...diffPath(a[i], b[i], `${path}[${i}]`));
    }
    return diffs;
  }

  const objA = a as Record<string, unknown>;
  const objB = b as Record<string, unknown>;

  const allKeys = new Set([...Object.keys(objA), ...Object.keys(objB)]);

  for (const key of allKeys) {
    if (!(key in objA)) {
      diffs.push(`${path}.${key}: missing in first`);
    } else if (!(key in objB)) {
      diffs.push(`${path}.${key}: missing in second`);
    } else {
      diffs.push(...diffPath(objA[key], objB[key], `${path}.${key}`));
    }
  }

  return diffs;
}

// ─────────────────────────────────────────────────────────────────────────────
// ASSERTIONS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Error thrown when determinism assertion fails.
 */
export class DeterminismError extends Error {
  constructor(
    message: string,
    public readonly differences: string[],
  ) {
    super(message);
    this.name = "DeterminismError";
  }
}

/**
 * Assert that replaying a trace produces the same result.
 *
 * @param original - Original rehearsal result
 * @param replayed - Replayed result
 * @param options - Comparison options
 * @throws DeterminismError if results differ
 *
 * @example
 * ```typescript
 * const original = await agent.rehearse().run(ctx);
 * const replayed = await agent.replay(original.trace).run(ctx);
 *
 * assertDeterministic(original, replayed.value);
 * ```
 */
export function assertDeterministic<T>(
  original: RehearsalResult<T>,
  replayed: ReplayResult<T>,
  options: DeepEqualOptions = {},
): void {
  // Check for critical divergences
  const criticalDivergences = replayed.divergences.filter(
    (d) => d.severity === "critical",
  );

  if (criticalDivergences.length > 0) {
    const descriptions = criticalDivergences.map((d) => d.description);
    throw new DeterminismError(
      `Replay had ${criticalDivergences.length} critical divergence(s)`,
      descriptions,
    );
  }

  // Compare final outputs
  if (!deepEqual(original.value, replayed.value, options)) {
    const diffs = diffPath(original.value, replayed.value);
    throw new DeterminismError(
      `Replay produced different output (${diffs.length} differences)`,
      diffs,
    );
  }
}

/**
 * Assert that a value matches expected with detailed diff on failure.
 *
 * @param actual - Actual value
 * @param expected - Expected value
 * @param message - Optional error message
 * @throws Error if values don't match
 */
export function assertEqual<T>(actual: T, expected: T, message?: string): void {
  if (!deepEqual(actual, expected)) {
    const diffs = diffPath(actual, expected);
    const errorMsg = message ?? "Assertion failed";
    throw new Error(`${errorMsg}:\n${diffs.join("\n")}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// TEST HARNESS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Test harness configuration.
 */
export interface TestHarnessConfig {
  /** Base directory for test traces */
  traceDir?: string;
  /** Whether to auto-save traces */
  autoSave?: boolean;
  /** Comparison options */
  compareOptions?: DeepEqualOptions;
}

/**
 * Test harness for rehearsal-based testing.
 *
 * @example
 * ```typescript
 * const harness = createTestHarness({ traceDir: '__traces__/tests' });
 *
 * // Record a "golden" trace
 * const golden = await harness.record(myAgent, ctx);
 *
 * // Replay and verify
 * const result = await harness.replay(golden.trace);
 * expect(result.matched).toBe(true);
 *
 * // Or use the combined verify
 * await harness.verify(myAgent, ctx);
 * ```
 */
export class TestHarness {
  private readonly config: TestHarnessConfig;
  private readonly traces: Map<string, ExecutionTrace> = new Map();

  constructor(config: TestHarnessConfig = {}) {
    this.config = {
      traceDir: config.traceDir ?? "__traces__/tests",
      autoSave: config.autoSave ?? false,
      compareOptions: config.compareOptions ?? {},
    };
  }

  /**
   * Record a trace from an agent execution.
   *
   * @param execute - Function that runs the agent
   * @param name - Optional name for the trace
   * @returns The rehearsal result
   */
  async record<T>(
    execute: () => Promise<RehearsalResult<T>>,
    name?: string,
  ): Promise<RehearsalResult<T>> {
    const result = await execute();

    // Store for later replay
    const traceName = name ?? result.trace.id;
    this.traces.set(traceName, result.trace);

    return result;
  }

  /**
   * Replay a recorded trace.
   *
   * @param trace - The trace to replay
   * @param options - Replay options
   * @returns Replay result
   */
  async replay<T>(
    trace: ExecutionTrace<T>,
    options?: ReplayerOptions,
  ): Promise<ReplayResult<T>> {
    const replayer = new TraceReplayer(trace, options);
    return replayer.replay();
  }

  /**
   * Verify determinism by running the agent twice and comparing outputs.
   *
   * Pre-fix this called execute() once, then replayed the trace — which
   * trivially returned trace.finalOutput (identical to the original value) and
   * therefore never detected a non-deterministic agent.
   *
   * Fixed: execute() is called twice.  If both calls return the same value the
   * agent is deterministic.  A mismatch throws DeterminismError with a diff.
   *
   * @param execute - Function that runs the agent and returns a RehearsalResult
   * @throws DeterminismError if the two independent runs produce different values
   */
  async verify<T>(execute: () => Promise<RehearsalResult<T>>): Promise<void> {
    const run1 = await execute();
    const run2 = await execute();

    if (!deepEqual(run1.value, run2.value, this.config.compareOptions)) {
      const diffs = diffPath(run1.value, run2.value);
      throw new DeterminismError(
        `Agent produced different output on two independent executions (${diffs.length} difference(s))`,
        diffs,
      );
    }
  }

  /**
   * Get a stored trace by name.
   *
   * @param name - Trace name or ID
   * @returns The trace, or undefined if not found
   */
  getTrace(name: string): ExecutionTrace | undefined {
    return this.traces.get(name);
  }

  /**
   * Clear all stored traces.
   */
  clear(): void {
    this.traces.clear();
  }
}

/**
 * Create a test harness with configuration.
 *
 * @param config - Harness configuration
 */
export function createTestHarness(config?: TestHarnessConfig): TestHarness {
  return new TestHarness(config);
}

// ─────────────────────────────────────────────────────────────────────────────
// JEST/VITEST MATCHERS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Expect a replay result to be deterministic.
 * For use with Jest/Vitest custom matchers.
 *
 * @param result - Replay result to check
 * @returns Matcher result
 */
export function expectDeterministic<T>(result: ReplayResult<T>): {
  pass: boolean;
  message: () => string;
} {
  const criticalDivergences = result.divergences.filter(
    (d) => d.severity === "critical",
  );

  const pass = result.matched && criticalDivergences.length === 0;

  return {
    pass,
    message: () => {
      if (pass) {
        return "Expected replay to have divergences, but it matched";
      }
      const issues = criticalDivergences.map((d) => `  - ${d.description}`);
      return `Expected deterministic replay, but found ${criticalDivergences.length} divergence(s):\n${issues.join("\n")}`;
    },
  };
}
