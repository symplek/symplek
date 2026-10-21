/**
 * @module AssertDeterministic - Step-by-step trace comparison for CI determinism gates
 * @description assertDeterministic loads two JSONL trace files and compares every
 * tool_use entry in order (tool name, args, result). Sentinel lines are ignored.
 * Throws DeterminismViolationError on the first deviation. Resolves silently when
 * both traces are equivalent — safe to await inside a Vitest `it` block.
 * @rules @.cursor/rules/patterns/029-file-header-contracts.mdc
 */

import type { ToolUseEntry, TraceEntry } from "./index";
import { loadTrace } from "./index";

// ─── Error ────────────────────────────────────────────────────────────────────

export class DeterminismViolationError extends Error {
  constructor(
    /** Step index from trace A (-1 = step_count mismatch). */
    public readonly step: number,
    /** Dot-path to the first differing field: "tool", "args", "result", or "step_count". */
    public readonly fieldPath: string,
    /** Value from trace A. */
    public readonly valueA: unknown,
    /** Value from trace B. */
    public readonly valueB: unknown,
  ) {
    super(
      `DeterminismViolation at step ${step}, field "${fieldPath}": ` +
        `traceA = ${JSON.stringify(valueA)}, traceB = ${JSON.stringify(valueB)}`,
    );
    this.name = "DeterminismViolationError";
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function isToolUseEntry(entry: TraceEntry): entry is ToolUseEntry {
  return !("_type" in entry);
}

// ─── Assert Deterministic ─────────────────────────────────────────────────────

/**
 * Compare two JSONL trace files step-by-step.
 *
 * Only tool_use entries are compared; SessionEnd sentinels are ignored so that
 * differences in metadata (timestamps, plan_id) do not cause false failures.
 *
 * @param tracePathA - Path to the first (typically recorded) trace.
 * @param tracePathB - Path to the second (typically replayed) trace.
 * @throws {DeterminismViolationError} On the first differing step.
 *
 * @example
 * ```typescript
 * // In a Vitest suite:
 * it("replay is deterministic", async () => {
 *   await assertDeterministic("traces/golden.jsonl", "traces/replay.jsonl");
 * });
 * ```
 */
export async function assertDeterministic(
  tracePathA: string,
  tracePathB: string,
  /** Optional override for the file reader — inject in tests to avoid disk I/O. */
  reader?: (path: string, encoding: "utf8") => Promise<string>,
): Promise<void> {
  const [allA, allB] = await Promise.all([
    loadTrace(tracePathA, reader),
    loadTrace(tracePathB, reader),
  ]);

  const toolA = allA.filter(isToolUseEntry);
  const toolB = allB.filter(isToolUseEntry);

  if (toolA.length !== toolB.length) {
    throw new DeterminismViolationError(
      -1,
      "step_count",
      toolA.length,
      toolB.length,
    );
  }

  for (let i = 0; i < toolA.length; i++) {
    const a = toolA[i];
    const b = toolB[i];

    if (a.tool !== b.tool) {
      throw new DeterminismViolationError(a.step, "tool", a.tool, b.tool);
    }

    if (JSON.stringify(a.args) !== JSON.stringify(b.args)) {
      throw new DeterminismViolationError(a.step, "args", a.args, b.args);
    }

    if (JSON.stringify(a.result) !== JSON.stringify(b.result)) {
      throw new DeterminismViolationError(a.step, "result", a.result, b.result);
    }
  }
}
