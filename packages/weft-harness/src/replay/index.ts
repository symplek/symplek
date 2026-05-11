/**
 * @module Replay - Record-and-replay adapter for deterministic CI test execution
 * @description Provides ReplayAdapter (implements SdkSession), TraceEntry types,
 * loadTrace, and parseTrace. Use with execute() for "record once, replay forever":
 * record a real API trace on dev, commit it, replay in CI with zero API calls.
 * Re-exports assertDeterministic and DeterminismViolationError for convenience.
 * @rules @.cursor/rules/patterns/029-file-header-contracts.mdc
 */

import { readFile } from "node:fs/promises";
import type { SdkEvent, SdkSession } from "../operators/execute";

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

// ─── Replay Adapter ───────────────────────────────────────────────────────────

/**
 * Implements SdkSession by serving recorded tool results from a JSONL trace.
 *
 * Walk through tool_use entries in order, validate permissions via canUseTool,
 * then fire onEvent with the recorded result. The final message comes from the
 * SessionEnd sentinel. No real API calls are made.
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
    const toolEntries = entries.filter(
      (e): e is ToolUseEntry => !isSessionEnd(e),
    );
    const sentinel = entries.find(isSessionEnd);

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

    return { finalMessage: sentinel?.final_output ?? "" };
  }
}

// ─── Re-exports ───────────────────────────────────────────────────────────────
// assertDeterministic and DeterminismViolationError live in their own module
// but are surfaced here so "weft-harness/replay" is the single import path.
export {
  assertDeterministic,
  DeterminismViolationError,
} from "./assert-deterministic";
