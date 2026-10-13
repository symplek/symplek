/**
 * @module Execute - Bounded AgentUnit operator for verified plan execution
 * @description Implements `execute()` — runs a Claude Agent SDK session in
 * `acceptEdits` mode gated by the permission bridge derived from a VerifiedPlan.
 * Supports optional rehearsal tracing (JSONL) and best-effort file rollback on
 * HarnessDeviationError. The real SdkSession instance is injected by the adapter
 * (W1-B); this module owns the execution contract.
 * @rules @.cursor/rules/patterns/029-file-header-contracts.mdc
 */

import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { ResultSource, TrackedResult } from "weft-core";
import { AgentUnit, createTrackedResult } from "weft-core";
import { ContractViolationError, HarnessDeviationError } from "../errors.js";
import { buildPermissionBridge } from "../permission-bridge.js";
import type { SessionEndEntry } from "../replay/index.js";
import type { ExecuteOptions, VerifiedPlan } from "../types.js";

// ─── SDK Interface Stub ───────────────────────────────────────────────────────
// @anthropic-ai/claude-agent-sdk is NOT a direct dependency. The adapter module
// (adapter/claude-agent-sdk.ts, W1-B) constructs a real session that satisfies
// this interface and passes it in. This stub is sufficient for type-checking the
// execute logic without importing the SDK at all.

export interface SdkEvent {
  type: string;
  tool?: string;
  args?: unknown;
  result?: unknown;
}

export interface SdkSession {
  run(options: {
    permissionMode: "default" | "acceptEdits" | "bypassPermissions";
    canUseTool?: (
      toolName: string,
      args: unknown,
    ) => { behavior: "allow" | "block" };
    onEvent?: (event: SdkEvent) => void;
  }): Promise<{ finalMessage: string }>;
}

// ─── Rollback Snapshot ────────────────────────────────────────────────────────

interface FileSnapshot {
  path: string;
  contents: Buffer | null; // null = file did not exist before the session
}

async function snapshotPaths(paths: string[]): Promise<FileSnapshot[]> {
  return Promise.all(
    paths.map(async (path) => {
      try {
        const contents = await readFile(path);
        return { path, contents };
      } catch {
        // File doesn't exist yet — record absence so we can delete on rollback.
        return { path, contents: null };
      }
    }),
  );
}

async function restoreSnapshots(snapshots: FileSnapshot[]): Promise<void> {
  // Best-effort: log individual failures but don't rethrow so the original
  // HarnessDeviationError remains the visible cause.
  await Promise.allSettled(
    snapshots.map(async ({ path, contents }) => {
      if (contents === null) {
        // File was created during the session; remove it.
        const { unlink } = await import("node:fs/promises");
        await unlink(path).catch(() => undefined);
      } else {
        await writeFile(path, contents);
      }
    }),
  );
}

// ─── Rehearsal Trace ──────────────────────────────────────────────────────────

interface BufferedEvent {
  tool: string;
  args: unknown;
  result: unknown;
  /** When the event happened, not when the trace was written. */
  timestamp: number;
}

/**
 * Append the buffered events to the trace file in one write, numbered in the
 * order they happened. `sessionEnd` goes last and is passed only for a run
 * that completed: a trace with no SessionEnd line is the trace of a run that
 * failed.
 */
async function writeTrace(
  tracePath: string,
  events: readonly BufferedEvent[],
  sessionEnd?: SessionEndEntry,
): Promise<void> {
  const entries: unknown[] = events.map((event, index) => ({
    step: index + 1,
    ...event,
  }));
  if (sessionEnd) entries.push(sessionEnd);
  if (entries.length === 0) return;

  await mkdir(dirname(tracePath), { recursive: true });
  await appendFile(
    tracePath,
    entries.map((entry) => `${JSON.stringify(entry)}\n`).join(""),
    { encoding: "utf8" },
  );
}

// ─── Execute Operator ─────────────────────────────────────────────────────────

/**
 * Run a verified plan inside a bounded SDK session.
 *
 * The returned `AgentUnit` is lazy — the session only starts when `.run()` is
 * called by the caller.
 *
 * **isStub default is `true`**: calling `execute(session, plan)` with no third
 * or fourth argument produces `source:"synthesized"`, not `source:"verified"`.
 * Pass `{ isStub: false }` only when the session is a real SDK session that
 * actually executed the plan. This ensures that replay adapters, stubs, and
 * any session whose provenance is unknown default to the honest label.
 *
 * @param session  - An SdkSession provided by the adapter (W1-B).
 * @param verified - The consensus-approved VerifiedPlan to execute.
 * @param options  - Optional rehearsal trace, deviation behaviour, and
 *                   `allowShell` flag forwarded to the permission bridge.
 * @param context  - Execution context. A session is treated as a stub unless
 *                   told otherwise, so un-labelled callers get
 *                   `source:"synthesized"`. Pass `{ isStub: false }` to stamp
 *                   `source:"verified"` on real SDK execution.
 */
export function execute<T>(
  session: SdkSession,
  verified: VerifiedPlan<T>,
  options: ExecuteOptions = {},
  context: { isStub?: boolean } = {},
): AgentUnit<TrackedResult<T>> {
  return AgentUnit.from<TrackedResult<T>>(async (_ctx) => {
    const bridge = buildPermissionBridge(verified as VerifiedPlan<unknown>, {
      allowShell: options.allowShell,
    });
    const tracePath =
      options.rehearsalPath ?? `traces/${verified.plan.id}.jsonl`;

    // Snapshot file paths before execution when rollback is requested.
    const declaredPaths = verified.plan.steps
      .filter((s) => s.targetPath !== undefined)
      .map((s) => s.targetPath as string);

    const snapshots: FileSnapshot[] =
      options.onDeviation === "rollback"
        ? await snapshotPaths(declaredPaths)
        : [];

    // Events are buffered as they happen, each with its own timestamp, and
    // written once the session has ended, whether it completed or failed.
    const eventBuffer: BufferedEvent[] = [];

    const needsProgressOrRehearsal =
      options.rehearse || options.onProgress !== undefined;
    const onEvent = needsProgressOrRehearsal
      ? (event: SdkEvent): void => {
          if (event.type === "tool_use") {
            options.onProgress?.({
              phase: "executing",
              tool: event.tool ?? "unknown",
            });
            if (options.rehearse) {
              eventBuffer.push({
                tool: event.tool ?? "unknown",
                args: event.args,
                result: event.result,
                timestamp: Date.now(),
              });
            }
          }
        }
      : undefined;

    options.onProgress?.({ phase: "executing", message: "Starting execution" });

    // Set once the run has completed and its output has met the contract.
    // The trace is written either way, so a failed run can be inspected.
    let sessionEnd: SessionEndEntry | undefined;
    try {
      let sdkResult: { finalMessage: string };
      try {
        sdkResult = await session.run({
          permissionMode: "acceptEdits",
          canUseTool: bridge,
          onEvent,
        });
      } catch (err) {
        if (err instanceof HarnessDeviationError) {
          options.onProgress?.({ phase: "failed", message: err.message });
          if (options.onDeviation === "rollback") {
            await restoreSnapshots(snapshots);
          }
        }
        throw err;
      }

      options.onProgress?.({ phase: "complete", planId: verified.plan.id });

      // ── Contract Validation ────────────────────────────────────────────────
      if (
        verified.expectedOutput !== undefined &&
        verified.expectedOutput !== null
      ) {
        const schema = verified.expectedOutput as unknown as {
          parse?: (value: unknown) => unknown;
          description?: string;
        };
        if (typeof schema.parse === "function") {
          try {
            schema.parse(sdkResult.finalMessage);
          } catch {
            throw new ContractViolationError(
              `Output contract violated: plan ${verified.plan.id} expected output matching "${schema.description ?? "schema"}" but actual output did not satisfy the schema`,
              verified.plan.id,
              schema.description ?? "schema",
              JSON.stringify(sdkResult.finalMessage).slice(0, 500),
            );
          }
        }
      }

      sessionEnd = {
        _type: "SessionEnd",
        plan_id: verified.plan.id,
        total_steps: eventBuffer.length,
        final_output: sdkResult.finalMessage,
      };

      // ── Build result ────────────────────────────────────────────────────────
      // source:"verified" is only honest when a real SDK session executed the
      // plan, so a session is a stub unless the caller says otherwise.
      const isStub = context.isStub ?? true;
      const source: ResultSource = isStub ? "synthesized" : "verified";
      return createTrackedResult(sdkResult.finalMessage as unknown as T, {
        source,
        confidence: verified.approvalScore,
        sourceChain: verified.plan.sources.map(() => source),
        minChainConfidence: verified.approvalScore,
        // verifiedAt/verifiedBy only make sense when a real execution happened.
        ...(source === "verified"
          ? {
              verifiedAt: Date.now(),
              verifiedBy: `weft-harness/execute@${verified.plan.id}`,
            }
          : {}),
      });
    } finally {
      if (options.rehearse) {
        await writeTrace(tracePath, eventBuffer, sessionEnd).catch(
          (traceError: unknown) => {
            // When the run itself failed, that error is the one to report.
            if (sessionEnd) throw traceError;
          },
        );
      }
    }
  });
}
