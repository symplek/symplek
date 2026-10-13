/**
 * @module execute-trace.test — H10 + trace-on-failure assertions
 * @description Verifies that rehearsal traces written by execute() have:
 *   - All tool_use entries in step order (step 1, 2, 3, ...)
 *   - SessionEnd as the final line on successful runs
 *   - Partial trace on deviation (no SessionEnd, events up to failure)
 *   - Partial trace on contract violation (no SessionEnd, all events)
 *   - Per-event timestamps captured at event-fire time, not at flush time
 * @rules @.cursor/rules/patterns/029-file-header-contracts.mdc
 */

import { mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createContext } from "weft-core";
import { execute } from "../operators/execute";
import type { SdkEvent, SdkSession } from "../operators/execute";
import { HarnessDeviationError } from "../errors";
import { parseTrace, isSessionEnd } from "../replay/index";
import type { ToolUseEntry } from "../replay/index";
import type { VerifiedPlan } from "../types";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const ctx = createContext();
let traceDir: string;

beforeAll(async () => {
  traceDir = join(tmpdir(), `weft-harness-trace-test-${Date.now()}`);
  await mkdir(traceDir, { recursive: true });
});

afterAll(async () => {
  await rm(traceDir, { recursive: true, force: true });
});

/**
 * A mock SDK session that fires N synchronous tool_use events via onEvent,
 * then returns. Used to check that execute() writes them in correct order.
 */
function makeMultiEventSession(eventCount: number): SdkSession {
  return {
    async run(options) {
      for (let i = 0; i < eventCount; i++) {
        const event: SdkEvent = {
          type: "tool_use",
          tool: `Tool${i + 1}`,
          args: { index: i },
          result: `result-${i + 1}`,
        };
        options.onEvent?.(event);
      }
      return { finalMessage: "all events fired" };
    },
  };
}

function makeVerifiedPlan(id = "trace-order-plan"): VerifiedPlan<unknown> {
  return {
    plan: {
      id,
      intent: "trace ordering test",
      steps: [],
      requiredTools: [],
      estimatedImpact: "P3",
      sources: [],
    },
    votes: [],
    approvalScore: 0.9,
  };
}

// ─── H10: Trace ordering ──────────────────────────────────────────────────────

describe("H10 — rehearsal traces are written in event order with SessionEnd last", () => {
  it("5 events are written in step order 1-5", async () => {
    const tracePath = join(traceDir, "order-5.jsonl");
    const session = makeMultiEventSession(5);
    const verified = makeVerifiedPlan("order-5");

    const unit = execute(session, verified, { rehearse: true, rehearsalPath: tracePath }, { isStub: false });
    await unit.run(ctx, { trustMode: "legacy" });

    const content = await readFile(tracePath, "utf8");
    const entries = parseTrace(content);

    const toolEntries = entries.filter((e) => !isSessionEnd(e)) as ToolUseEntry[];
    const sentinel = entries.find(isSessionEnd);

    // Steps must be in order
    for (let i = 0; i < toolEntries.length; i++) {
      expect(toolEntries[i].step).toBe(i + 1);
    }

    // SessionEnd must be the last line
    const lastEntry = entries[entries.length - 1];
    expect(isSessionEnd(lastEntry)).toBe(true);
    expect(sentinel).toBeDefined();
  });

  it("25 events: SessionEnd is always the last entry", async () => {
    const tracePath = join(traceDir, "order-25.jsonl");
    const session = makeMultiEventSession(25);
    const verified = makeVerifiedPlan("order-25");

    const unit = execute(session, verified, { rehearse: true, rehearsalPath: tracePath }, { isStub: false });
    await unit.run(ctx, { trustMode: "legacy" });

    const content = await readFile(tracePath, "utf8");
    const entries = parseTrace(content);

    // SessionEnd must be LAST
    const lastEntry = entries[entries.length - 1];
    expect(isSessionEnd(lastEntry)).toBe(true);

    // All 25 tool entries must appear before the sentinel
    const toolEntries = entries.filter((e) => !isSessionEnd(e));
    expect(toolEntries).toHaveLength(25);

    // Steps must be monotonically increasing
    for (let i = 0; i < toolEntries.length; i++) {
      expect((toolEntries[i] as ToolUseEntry).step).toBe(i + 1);
    }
  });
});

// ─── Trace on failure ─────────────────────────────────────────────────────────

describe("trace on failure — partial trace is written when the run does not complete", () => {
  it("deviation mid-run writes buffered events but no SessionEnd", async () => {
    const tracePath = join(traceDir, "deviation.jsonl");

    // Session fires 2 events then throws HarnessDeviationError mid-run.
    const deviatingSession: SdkSession = {
      async run(options) {
        const event1: SdkEvent = { type: "tool_use", tool: "Tool1", args: {}, result: "r1" };
        const event2: SdkEvent = { type: "tool_use", tool: "Tool2", args: {}, result: "r2" };
        options.onEvent?.(event1);
        options.onEvent?.(event2);
        throw new HarnessDeviationError(
          "Test deviation",
          "Tool2",
          "unauthorized_tool",
          "deviation-plan",
        );
      },
    };

    const verified = makeVerifiedPlan("deviation-plan");

    const unit = execute(
      deviatingSession,
      verified,
      { rehearse: true, rehearsalPath: tracePath },
      { isStub: false },
    );

    // The unit throws — catch it so we can inspect the trace.
    await expect(unit.run(ctx, { trustMode: "legacy" })).rejects.toBeInstanceOf(
      HarnessDeviationError,
    );

    const content = await readFile(tracePath, "utf8");
    const entries = parseTrace(content);

    // Both events before the throw must be present.
    const toolEntries = entries.filter((e) => !isSessionEnd(e)) as ToolUseEntry[];
    expect(toolEntries).toHaveLength(2);
    expect(toolEntries[0].step).toBe(1);
    expect(toolEntries[1].step).toBe(2);

    // No SessionEnd — the session did not complete normally.
    expect(entries.find(isSessionEnd)).toBeUndefined();
  });

  it("contract violation writes all events but no SessionEnd", async () => {
    const tracePath = join(traceDir, "contract.jsonl");

    // Session fires 3 events then returns normally; contract then fails.
    const contractSession: SdkSession = {
      async run(options) {
        for (let i = 1; i <= 3; i++) {
          options.onEvent?.({ type: "tool_use", tool: `Tool${i}`, args: {}, result: `r${i}` });
        }
        return { finalMessage: "wrong output" };
      },
    };

    const verified: VerifiedPlan<unknown> = {
      ...makeVerifiedPlan("contract-plan"),
      expectedOutput: {
        parse: (v: unknown) => {
          if (v !== "expected output") throw new Error("mismatch");
          return v;
        },
        description: "exact string",
      },
    };

    const unit = execute(
      contractSession,
      verified,
      { rehearse: true, rehearsalPath: tracePath },
      { isStub: false },
    );

    await expect(unit.run(ctx, { trustMode: "legacy" })).rejects.toThrow(
      "Output contract violated",
    );

    const content = await readFile(tracePath, "utf8");
    const entries = parseTrace(content);

    const toolEntries = entries.filter((e) => !isSessionEnd(e)) as ToolUseEntry[];
    expect(toolEntries).toHaveLength(3);

    // No SessionEnd.
    expect(entries.find(isSessionEnd)).toBeUndefined();
  });
});

// ─── Event timestamps ─────────────────────────────────────────────────────────

describe("event timestamps — entries carry per-event timestamps, not flush-time timestamps", () => {
  it("each entry carries the time its event happened, not the time the trace was written", async () => {
    const tracePath = join(traceDir, "timestamps.jsonl");
    const now = vi.spyOn(Date, "now");

    // The clock reads 1000, 2000 and 3000 as the three events happen, and
    // 9000 from then on, which is when the trace is written.
    const session: SdkSession = {
      async run(options) {
        for (const at of [1000, 2000, 3000]) {
          now.mockReturnValue(at);
          options.onEvent?.({ type: "tool_use", tool: "Tool", args: {}, result: "r" });
        }
        now.mockReturnValue(9000);
        return { finalMessage: "done" };
      },
    };

    try {
      await execute(
        session,
        makeVerifiedPlan("timestamps"),
        { rehearse: true, rehearsalPath: tracePath },
        { isStub: false },
      ).run(ctx, { trustMode: "legacy" });
    } finally {
      now.mockRestore();
    }

    const toolEntries = parseTrace(await readFile(tracePath, "utf8")).filter(
      (e) => !isSessionEnd(e),
    ) as ToolUseEntry[];
    expect(toolEntries.map((e) => e.timestamp)).toEqual([1000, 2000, 3000]);
  });
});
