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
import type { ResultSource, TrackedResult } from "@symplek/core";
import { AgentUnit, createTrackedResult } from "@symplek/core";
import { ContractViolationError, HarnessDeviationError } from "../errors.js";
import { buildPermissionBridge } from "../permission-bridge.js";
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

async function appendTrace(tracePath: string, entry: unknown): Promise<void> {
  // Create the parent directory if it doesn't exist (e.g. traces/ on first run).
  await mkdir(dirname(tracePath), { recursive: true });
  await appendFile(tracePath, `${JSON.stringify(entry)}\n`, {
    encoding: "utf8",
  });
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
 * @param context  - Execution context. Defaults to `{ isStub: true }` so
 *                   un-labelled callers get `source:"synthesized"`. Pass
 *                   `{ isStub: false }` to stamp `source:"verified"` on real
 *                   SDK execution.
 */
export function execute<T>(
  session: SdkSession,
  verified: VerifiedPlan<T>,
  options: ExecuteOptions = {},
  context: { isStub?: boolean } = { isStub: true },
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

    // ── H10 fix: Buffer events synchronously during the SDK session, then
    // write them to the trace file in order AFTER the session returns.
    // Previously, `void onEvent(event)` was used, making appendFile calls
    // fire-and-forget; events could be written out of step order and the
    // SessionEnd sentinel could land before outstanding tool entries.
    //
    // Now: onEvent pushes to a buffer synchronously (no async in the
    // callback). After session.run() resolves, we flush the buffer in
    // insertion order, then write the sentinel last.
    interface BufferedEvent {
      tool: string;
      args: unknown;
      result: unknown;
    }
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
              });
            }
          }
        }
      : undefined;

    options.onProgress?.({ phase: "executing", message: "Starting execution" });

    let sdkResult: { finalMessage: string };
    try {
      sdkResult = await session.run({
        permissionMode: "acceptEdits",
        canUseTool: bridge,
        onEvent,
      });
    } catch (err) {
      if (err instanceof HarnessDeviationError) {
        options.onProgress?.({
          phase: "failed",
          message: err instanceof Error ? err.message : String(err),
        });
        if (options.onDeviation === "rollback") {
          await restoreSnapshots(snapshots);
        }
        throw err;
      }
      throw err;
    }

    options.onProgress?.({ phase: "complete", planId: verified.plan.id });

    // ── Contract Validation ──────────────────────────────────────────────────
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

    // ── Flush buffered events in insertion order, then write sentinel last ───
    // This replaces the old `void onEvent(event)` pattern that allowed events
    // to be written out of order and the sentinel to precede tool entries.
    if (options.rehearse) {
      let stepCounter = 0;
      for (const buffered of eventBuffer) {
        const entry = {
          step: ++stepCounter,
          tool: buffered.tool,
          args: buffered.args,
          result: buffered.result,
          timestamp: Date.now(),
        };
        await appendTrace(tracePath, entry);
      }
      await appendTrace(tracePath, {
        _type: "SessionEnd",
        plan_id: verified.plan.id,
        total_steps: eventBuffer.length,
        final_output: sdkResult.finalMessage,
      });
    }

    // ── Build result ──────────────────────────────────────────────────────────
    // source:"verified" is only honest when a real SDK session executed the plan.
    // Default is isStub:true so un-labelled callers get "synthesized".
    const isStub = context.isStub ?? true;
    const source: ResultSource = isStub ? "synthesized" : "verified";
    const tracked = createTrackedResult(sdkResult.finalMessage as unknown as T, {
      source,
      confidence: verified.approvalScore,
      sourceChain: verified.plan.sources.map(() => source),
      minChainConfidence: verified.approvalScore,
      // verifiedAt/verifiedBy only make sense when a real execution happened.
      ...(source === "verified"
        ? {
            verifiedAt: Date.now(),
            verifiedBy: `@symplek/harness/execute@${verified.plan.id}`,
          }
        : {}),
    });

    return tracked;
  });
}
