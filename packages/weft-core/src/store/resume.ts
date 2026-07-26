/**
 * @module weft-core/store/resume
 * @description `resume()` — replay a prior run from its durable journal (CR-403).
 *
 *   Mechanism: `resume()` runs the unit with the durable idempotency store and
 *   `strategy: "return-cached"`. Steps whose idempotency keys were written to
 *   the store during the original run return their cached `TrackedResult`
 *   immediately. Steps whose keys were never written (because the original run
 *   crashed or was interrupted before those steps completed) re-execute.
 *
 *   REQUIRES: the original run used idempotency keys prefixed with `runId`.
 *   Each sub-step should use a key like `${runId}:step1`, `${runId}:step2`, etc.
 *   so that `resume()` can supply the store and the per-step lookups succeed.
 *
 *   The `runId` itself is used as the idempotency key for the outer run. If the
 *   entire run was committed, `resume()` returns the cached result without
 *   executing any steps.
 *
 *   GUARANTEE BOUNDARY (stated verbatim per repair-campaign rule):
 *   At-most-once delivery is narrowed but not eliminated. If `backend.set()`
 *   failed after a side effect ran, that step's key was never written. A
 *   resumed run that re-executes such a step will re-run the side effect.
 *   Resume guarantees only that steps whose journal entry landed will not
 *   re-execute. Steps whose entry did not land WILL re-execute on every resume.
 *   Making side effects themselves idempotent is the only way to achieve true
 *   at-most-once in the presence of store write failures.
 *
 * @since 2.2.0 — CR-403
 * @runtime node
 * @surface public
 */

import type { AgentUnit } from "../AgentUnit";
import type { AgentContext, TrackedResult } from "../types";
import type { DurableStoreOptions } from "./backend";

/**
 * Options for {@link resume}.
 */
export interface ResumeOptions {
  /** Durable store containing the journal entries from the original run. */
  store: DurableStoreOptions;
  /**
   * When true, logs each step outcome (replayed vs re-executed) to stderr.
   * Format: `[weft-resume] {runId} step {key}: replayed | re-executed`
   * @default false
   */
  verbose?: boolean;
}

/**
 * Replay a prior run from its durable journal, skipping completed steps.
 *
 * @example
 * ```typescript
 * import { resume, createDurableStore, createFileBackend } from "weft-core/store";
 *
 * const store = createDurableStore(createFileBackend("./.weft-journal"));
 *
 * // Original run (may have been interrupted):
 * await unit.run(ctx, {
 *   idempotency: { key: `${runId}:step1`, strategy: "return-cached", store: store.idempotency },
 * });
 *
 * // Resume (steps with committed keys return cached; uncommitted steps re-run):
 * const result = await resume(runId, unit, createContext(), { store });
 * ```
 *
 * @param runId   Stable identifier for the original run. Used as the idempotency
 *                key for the outer unit, and as the prefix to match per-step keys.
 * @param unit    The `AgentUnit` to execute (same unit as the original run).
 * @param context `AgentContext` for the resumed execution. The durable store is
 *                injected into `context.extensions.__weft_resume_store` so that
 *                sub-steps executed inside `flatMap` chains can read the store.
 * @param options Resume options including the durable store.
 */
export async function resume<T>(
  runId: string,
  unit: AgentUnit<T>,
  context: AgentContext,
  options: ResumeOptions,
): Promise<TrackedResult<T>> {
  const { store, verbose } = options;

  // Inject the store into context.extensions so sub-steps can access it.
  const resumeCtx: AgentContext = {
    ...context,
    extensions: {
      ...context.extensions,
      __weft_resume_store: store,
      __weft_run_id: runId,
    },
  };

  if (verbose) {
    const cached = await store.idempotency.get(runId);
    if (cached !== null) {
      process.stderr.write(`[weft-resume] ${runId}: replayed (whole-run cache hit)\n`);
    } else {
      process.stderr.write(`[weft-resume] ${runId}: re-executing (no whole-run cache)\n`);
    }
  }

  // Run the unit with the durable idempotency store.
  // Sub-steps that used `${runId}:stepN` keys during the original run will
  // find their cached results; uncommitted steps will re-execute.
  return (unit as unknown as {
    run(
      ctx: AgentContext,
      opts: {
        idempotency: {
          key: string;
          strategy: "return-cached";
          store: typeof store.idempotency;
        };
      },
    ): Promise<TrackedResult<T>>;
  }).run(resumeCtx, {
    idempotency: {
      key: runId,
      strategy: "return-cached",
      store: store.idempotency,
    },
  });
}
