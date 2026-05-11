/**
 * @module Execute - Bounded AgentUnit operator for verified plan execution
 * @description Implements `execute()` — runs a Claude Agent SDK session in
 * `acceptEdits` mode gated by the permission bridge derived from a VerifiedPlan.
 * Supports optional rehearsal tracing (JSONL) and best-effort file rollback on
 * HarnessDeviationError. The real SdkSession instance is injected by the adapter
 * (W1-B); this module owns the execution contract.
 * @rules @.cursor/rules/patterns/029-file-header-contracts.mdc
 */

import { appendFile, readFile, writeFile } from "node:fs/promises";
import type { TrackedResult } from "weft-core";
import { AgentUnit, TRACKED_MARKER } from "weft-core";
import { ContractViolationError, HarnessDeviationError } from "../errors";
import { buildPermissionBridge } from "../permission-bridge";
import type { ExecuteOptions, VerifiedPlan } from "../types";

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
 * @param session  - An SdkSession provided by the adapter (W1-B).
 * @param verified - The consensus-approved VerifiedPlan to execute.
 * @param options  - Optional rehearsal trace and deviation behaviour.
 */
export function execute<T>(
  session: SdkSession,
  verified: VerifiedPlan<T>,
  options: ExecuteOptions = {},
): AgentUnit<TrackedResult<T>> {
  return AgentUnit.from<TrackedResult<T>>(async (_ctx) => {
    const bridge = buildPermissionBridge(verified as VerifiedPlan<unknown>);
    const tracePath =
      options.rehearsalPath ?? `traces/${verified.plan.id}.jsonl`;
    let stepCounter = 0;

    // Snapshot file paths before execution when rollback is requested.
    // This is a simplified best-effort rollback — it restores the pre-session
    // state of every declared target path but cannot undo network side-effects.
    const declaredPaths = verified.plan.steps
      .filter((s) => s.targetPath !== undefined)
      .map((s) => s.targetPath as string);

    const snapshots: FileSnapshot[] =
      options.onDeviation === "rollback"
        ? await snapshotPaths(declaredPaths)
        : [];

    const needsEvent = options.rehearse || options.onProgress !== undefined;
    const onEvent = needsEvent
      ? async (event: SdkEvent) => {
          if (event.type === "tool_use") {
            options.onProgress?.({
              phase: "executing",
              tool: event.tool ?? "unknown",
            });
            if (options.rehearse) {
              const entry = {
                step: ++stepCounter,
                tool: event.tool ?? "unknown",
                args: event.args,
                result: event.result,
                timestamp: Date.now(),
              };
              await appendTrace(tracePath, entry);
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
        onEvent: onEvent
          ? (event) => {
              void onEvent(event);
            }
          : undefined,
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

    // ─── Contract Validation ─────────────────────────────────────────────────
    // If the VerifiedPlan declared an expectedOutput schema, validate the actual
    // SDK output against it. Duck-typed .parse() avoids vendor lock-in — works
    // with Valibot, Zod, or any library that exposes a .parse(value) method.
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

    // Write sentinel on session end when rehearsing.
    if (options.rehearse) {
      await appendTrace(tracePath, {
        _type: "SessionEnd",
        plan_id: verified.plan.id,
        total_steps: stepCounter,
        final_output: sdkResult.finalMessage,
      });
    }

    // Build a TrackedResult<T> inheriting source chain from the verified plan.
    // Sources come from VerifiedPlan.plan.sources (SourceRef[]), mapped to the
    // "verified" ResultSource since the plan passed consensus approval.
    const tracked: TrackedResult<T> = {
      [TRACKED_MARKER]: true,
      value: sdkResult.finalMessage as unknown as T,
      source: "verified",
      confidence: verified.approvalScore,
      sourceChain: verified.plan.sources.map(() => "verified" as const),
      minChainConfidence: verified.approvalScore,
      verifiedAt: Date.now(),
      verifiedBy: `weft-harness/execute@${verified.plan.id}`,
    };

    return tracked;
  });
}
