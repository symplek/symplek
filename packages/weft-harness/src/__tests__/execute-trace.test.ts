/**
 * @module execute-trace.test — H10: Rehearsal trace ordering
 * @description Verifies that rehearsal traces written by execute() have:
 *   - All tool_use entries in step order (step 1, 2, 3, ...)
 *   - SessionEnd as the final line
 * Before the H10 fix, onEvent was called with `void`, so async appendFile
 * calls were not awaited; events could be written out of order.
 * @rules @.cursor/rules/patterns/029-file-header-contracts.mdc
 */

import { mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createContext } from "@symplek/core";
import { execute } from "../operators/execute";
import type { SdkEvent, SdkSession } from "../operators/execute";
import { parseTrace, isSessionEnd } from "../replay/index";
import type { ToolUseEntry } from "../replay/index";
import type { VerifiedPlan } from "../types";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const ctx = createContext();
let traceDir: string;

beforeAll(async () => {
  traceDir = join(tmpdir(), `symplek-harness-trace-test-${Date.now()}`);
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
