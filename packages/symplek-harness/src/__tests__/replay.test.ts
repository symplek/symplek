/**
 * @module ReplayTests - Unit tests for ReplayAdapter and assertDeterministic
 * @description Verifies the "record once, replay forever" CI capability:
 * identical traces pass, deviated traces throw, ReplayAdapter returns finalMessage.
 * File I/O is injected via the optional `reader` parameter — no real files needed.
 * @rules @.cursor/rules/patterns/029-file-header-contracts.mdc
 */

import { describe, expect, it } from "vitest";
import {
  assertDeterministic,
  DeterminismViolationError,
} from "../replay/assert-deterministic";
import {
  parseTrace,
  ReplayAdapter,
  ReplayMismatchError,
} from "../replay/index";

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Build a JSONL string from an array of objects. */
function toJSONL(entries: object[]): string {
  return `${entries.map((e) => JSON.stringify(e)).join("\n")}\n`;
}

/**
 * Create a reader that serves `content` for any path requested.
 * Satisfies the `(path, encoding) => Promise<string>` signature.
 */
function makeReader(
  content: string,
): (path: string, encoding: "utf8") => Promise<string> {
  return async (_path, _encoding) => content;
}

/**
 * Create a reader that routes requests by path.
 */
function makeMultiReader(
  map: Record<string, string>,
): (path: string, encoding: "utf8") => Promise<string> {
  return async (path, _encoding) => {
    if (path in map) return map[path];
    throw new Error(`No mock content for path: ${path}`);
  };
}

const TOOL_ENTRY_1 = {
  step: 1,
  tool: "Read",
  args: { path: "src/utils.ts" },
  result: "export function foo() {}",
  timestamp: 1000,
};

const TOOL_ENTRY_2 = {
  step: 2,
  tool: "Edit",
  args: { path: "src/utils/email.ts", content: "// email helpers" },
  result: "ok",
  timestamp: 2000,
};

const SENTINEL = {
  _type: "SessionEnd",
  plan_id: "plan-test-v1",
  total_steps: 2,
  final_output: "Refactor complete.",
};

const GOLDEN_TRACE = toJSONL([TOOL_ENTRY_1, TOOL_ENTRY_2, SENTINEL]);

// ─── assertDeterministic ──────────────────────────────────────────────────────

describe("assertDeterministic", () => {
  it("resolves without throwing when two traces are identical", async () => {
    const reader = makeReader(GOLDEN_TRACE);
    await expect(
      assertDeterministic("trace-a.jsonl", "trace-b.jsonl", reader),
    ).resolves.toBeUndefined();
  });

  it("throws DeterminismViolationError when result differs at step 2", async () => {
    const traceA = toJSONL([TOOL_ENTRY_1, TOOL_ENTRY_2, SENTINEL]);
    const traceB = toJSONL([
      TOOL_ENTRY_1,
      { ...TOOL_ENTRY_2, result: "UNEXPECTED_RESULT" },
      SENTINEL,
    ]);
    const reader = makeMultiReader({
      "trace-a.jsonl": traceA,
      "trace-b.jsonl": traceB,
    });

    const error = await assertDeterministic(
      "trace-a.jsonl",
      "trace-b.jsonl",
      reader,
    ).catch((e) => e);

    expect(error).toBeInstanceOf(DeterminismViolationError);
    expect((error as DeterminismViolationError).step).toBe(2);
    expect((error as DeterminismViolationError).fieldPath).toBe("result");
    expect((error as DeterminismViolationError).valueA).toBe("ok");
    expect((error as DeterminismViolationError).valueB).toBe(
      "UNEXPECTED_RESULT",
    );
  });

  it("throws DeterminismViolationError when step counts differ", async () => {
    const traceA = toJSONL([TOOL_ENTRY_1, TOOL_ENTRY_2, SENTINEL]);
    const traceB = toJSONL([TOOL_ENTRY_1, SENTINEL]);
    const reader = makeMultiReader({
      "trace-a.jsonl": traceA,
      "trace-b.jsonl": traceB,
    });

    const error = await assertDeterministic(
      "trace-a.jsonl",
      "trace-b.jsonl",
      reader,
    ).catch((e) => e);

    expect(error).toBeInstanceOf(DeterminismViolationError);
    expect((error as DeterminismViolationError).fieldPath).toBe("step_count");
  });

  it("ignores sentinel lines — only tool_use entries are compared", async () => {
    // Sentinels differ in plan_id; should NOT trigger a violation.
    const sentinelA = { ...SENTINEL, plan_id: "plan-A" };
    const sentinelB = { ...SENTINEL, plan_id: "plan-B" };
    const traceA = toJSONL([TOOL_ENTRY_1, sentinelA]);
    const traceB = toJSONL([TOOL_ENTRY_1, sentinelB]);
    const reader = makeMultiReader({
      "trace-a.jsonl": traceA,
      "trace-b.jsonl": traceB,
    });

    await expect(
      assertDeterministic("trace-a.jsonl", "trace-b.jsonl", reader),
    ).resolves.toBeUndefined();
  });
});

// ─── ReplayAdapter ────────────────────────────────────────────────────────────

describe("ReplayAdapter", () => {
  it("returns finalMessage matching the sentinel's final_output", async () => {
    const adapter = new ReplayAdapter({
      tracePath: "traces/test.jsonl",
      reader: makeReader(GOLDEN_TRACE),
    });

    const result = await adapter.run({ permissionMode: "acceptEdits" });

    expect(result.finalMessage).toBe("Refactor complete.");
  });

  it("fires onEvent for every tool_use entry in order", async () => {
    const events: { tool: string | undefined; step: number }[] = [];
    const adapter = new ReplayAdapter({
      tracePath: "traces/test.jsonl",
      reader: makeReader(GOLDEN_TRACE),
    });

    await adapter.run({
      permissionMode: "acceptEdits",
      onEvent: (event) => {
        if (event.type === "tool_use") {
          events.push({ tool: event.tool, step: events.length + 1 });
        }
      },
    });

    expect(events).toHaveLength(2);
    expect(events[0].tool).toBe("Read");
    expect(events[1].tool).toBe("Edit");
  });

  it("throws ReplayMismatchError when canUseTool blocks a tool", async () => {
    const adapter = new ReplayAdapter({
      tracePath: "traces/test.jsonl",
      reader: makeReader(GOLDEN_TRACE),
    });

    await expect(
      adapter.run({
        permissionMode: "acceptEdits",
        canUseTool: () => ({ behavior: "block" }),
      }),
    ).rejects.toBeInstanceOf(ReplayMismatchError);
  });

  it("returns empty finalMessage when trace has no sentinel", async () => {
    const noSentinelTrace = toJSONL([TOOL_ENTRY_1]);
    const adapter = new ReplayAdapter({
      tracePath: "traces/test.jsonl",
      reader: makeReader(noSentinelTrace),
    });

    const result = await adapter.run({ permissionMode: "acceptEdits" });

    expect(result.finalMessage).toBe("");
  });
});

// ─── parseTrace (pure, no I/O) ────────────────────────────────────────────────

describe("parseTrace", () => {
  it("correctly splits a JSONL string into TraceEntry objects", () => {
    const entries = parseTrace(GOLDEN_TRACE);
    expect(entries).toHaveLength(3);
    expect((entries[0] as { tool: string }).tool).toBe("Read");
    expect((entries[2] as { _type: string })._type).toBe("SessionEnd");
  });

  it("ignores blank lines", () => {
    const withBlanks = `\n${JSON.stringify(TOOL_ENTRY_1)}\n\n`;
    expect(parseTrace(withBlanks)).toHaveLength(1);
  });
});
