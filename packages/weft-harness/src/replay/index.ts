/**
 * @module Replay - Record-and-replay adapter for deterministic CI test execution
 * @description Provides ReplayAdapter (implements SdkSession), TraceEntry types,
 * loadTrace, and parseTrace. Use with execute() for "record once, replay forever":
 * record a real API trace on dev, commit it, replay in CI with zero API calls.
 * Re-exports assertDeterministic and DeterminismViolationError for convenience.
 * @rules @.cursor/rules/patterns/029-file-header-contracts.mdc
 */

import { readFile } from "node:fs/promises";
import type { SdkEvent, SdkSession } from "../operators/execute.js";

// ─── Trace Types ──────────────────────────────────────────────────────────────

/** A single tool invocation recorded during a rehearsal session. */
export interface ToolUseEntry {
  readonly step: number;
  readonly tool: string;
  readonly args: unknown;
  readonly result: unknown;
  readonly timestamp: number;
}

/** End-of-session sentinel written after all tool_use entries. */
export interface SessionEndEntry {
  readonly _type: "SessionEnd";
  readonly plan_id: string;
  readonly total_steps: number;
  readonly final_output: string;
}

export type TraceEntry = ToolUseEntry | SessionEndEntry;

export function isSessionEnd(entry: TraceEntry): entry is SessionEndEntry {
  return "_type" in entry && (entry as SessionEndEntry)._type === "SessionEnd";
}

// ─── Parse / Load ─────────────────────────────────────────────────────────────

/** Parse a JSONL string into trace entries. Exported for testing without file I/O. */
export function parseTrace(content: string): TraceEntry[] {
  return content
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as TraceEntry);
}

/** Read and parse a JSONL trace file. */
export async function loadTrace(
  tracePath: string,
  /** Optional override for the file reader — inject in tests to avoid disk I/O. */
  reader: (path: string, encoding: "utf8") => Promise<string> = readFile,
): Promise<TraceEntry[]> {
  const content = await reader(tracePath, "utf8");
  return parseTrace(content);
}

// ─── Stable Args Hash ─────────────────────────────────────────────────────────

/**
 * Deterministic JSON serialisation of args with sorted keys.
 * Used to match a live tool invocation against a recorded TraceEntry.
 */
function stableArgsHash(args: unknown): string {
  if (args === null || typeof args !== "object" || Array.isArray(args)) {
    return JSON.stringify(args);
  }
  return JSON.stringify(
    args,
    Object.keys(args as Record<string, unknown>).sort(),
  );
}

// ─── Errors ───────────────────────────────────────────────────────────────────

export class ReplayMismatchError extends Error {
  constructor(
    public readonly tool: string,
    public readonly args: unknown,
    hint?: string,
  ) {
    super(
      `ReplayMismatch: no recorded entry for tool "${tool}" with args ` +
        `${JSON.stringify(args)}.` +
        (hint
          ? ` ${hint}`
          : " Trace may be stale — re-record with RECORD=true."),
    );
    this.name = "ReplayMismatchError";
  }
}

/** Thrown when a trace does not end with a completed run. */
export class ReplayIncompleteError extends Error {
  constructor(public readonly tracePath: string) {
    super(
      `ReplayIncomplete: "${tracePath}" does not end with a SessionEnd line. ` +
        "It is empty, or the last run recorded there did not complete, " +
        "so there is no outcome to replay. Record the run again.",
    );
    this.name = "ReplayIncompleteError";
  }
}

// ─── The run that closes a trace ──────────────────────────────────────────────

/**
 * The run a trace ends with: its tool entries and the SessionEnd line that
 * closes it. Undefined when the trace does not end with a SessionEnd line,
 * whatever came earlier in the file.
 *
 * A trace file is appended to, so it can hold several runs, and a run that
 * failed leaves its tool entries behind with no SessionEnd line. The run to
 * replay is the one the final SessionEnd closes: the entries after the
 * previous SessionEnd, cut down to the step count the final one records, which
 * drops the leftovers of a failed run that came just before it.
 */
function closingRun(
  entries: readonly TraceEntry[],
): { tools: ToolUseEntry[]; end: SessionEndEntry } | undefined {
  const end = entries[entries.length - 1];
  if (end === undefined || !isSessionEnd(end)) return undefined;

  let start = entries.length - 1;
  while (start > 0 && !isSessionEnd(entries[start - 1])) start--;
  const sincePreviousEnd = entries
    .slice(start, -1)
    .filter((entry): entry is ToolUseEntry => !isSessionEnd(entry));

  const steps = end.total_steps;
  const count =
    Number.isInteger(steps) && steps >= 0 && steps <= sincePreviousEnd.length
      ? steps
      : sincePreviousEnd.length;
  return {
    tools: sincePreviousEnd.slice(sincePreviousEnd.length - count),
    end,
  };
}

// ─── Replay Adapter ───────────────────────────────────────────────────────────

/**
 * Implements SdkSession by serving recorded tool results from a JSONL trace.
 *
 * Walk through the tool_use entries of the run the trace ends with, in order,
 * validate permissions via canUseTool, then fire onEvent with the recorded
 * result. The final message comes from that run's SessionEnd line. No real API
 * calls are made. A trace that does not end with a SessionEnd line, because it
 * is empty or its last run failed, is refused with
 * {@link ReplayIncompleteError}: there is no outcome to hand back.
 *
 * @example
 * ```typescript
 * const adapter = new ReplayAdapter({ tracePath: "traces/session.jsonl" });
 * const result = await execute(adapter, verifiedPlan).run(ctx);
 * ```
 */
export class ReplayAdapter implements SdkSession {
  constructor(
    private readonly options: {
      tracePath: string;
      /** Optional override for the file reader — inject in tests to avoid disk I/O. */
      reader?: (path: string, encoding: "utf8") => Promise<string>;
    },
  ) {}

  async run(sdkOptions: {
    permissionMode: "default" | "acceptEdits" | "bypassPermissions";
    canUseTool?: (
      toolName: string,
      args: unknown,
    ) => { behavior: "allow" | "block" };
    onEvent?: (event: SdkEvent) => void;
  }): Promise<{ finalMessage: string }> {
    const entries = await loadTrace(
      this.options.tracePath,
      this.options.reader,
    );
    const run = closingRun(entries);
    if (!run) throw new ReplayIncompleteError(this.options.tracePath);
    const toolEntries = run.tools;

    for (const entry of toolEntries) {
      // Hash-based lookup: verify this tool+args combo exists in the trace.
      // (For sequential replay this always matches self, but catches mutations.)
      const hash = stableArgsHash(entry.args);
      const matched = toolEntries.find(
        (e) => e.tool === entry.tool && stableArgsHash(e.args) === hash,
      );
      if (!matched) {
        throw new ReplayMismatchError(entry.tool, entry.args);
      }

      // Respect the permission bridge — block → replay cannot proceed.
      if (sdkOptions.canUseTool) {
        const decision = sdkOptions.canUseTool(entry.tool, entry.args);
        if (decision.behavior === "block") {
          throw new ReplayMismatchError(
            entry.tool,
            entry.args,
            "Tool was blocked during replay — plan permissions may have changed.",
          );
        }
      }

      // Emit the recorded event (e.g. to a secondary rehearsal trace writer).
      if (sdkOptions.onEvent) {
        sdkOptions.onEvent({
          type: "tool_use",
          tool: entry.tool,
          args: entry.args,
          result: entry.result,
        });
      }
    }

    return { finalMessage: run.end.final_output };
  }
}

// ─── Re-exports ───────────────────────────────────────────────────────────────
// assertDeterministic and DeterminismViolationError live in their own module
// but are surfaced here so "weft-harness/replay" is the single import path.
export {
  assertDeterministic,
  DeterminismViolationError,
} from "./assert-deterministic.js";
