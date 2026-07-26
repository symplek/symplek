/**
 * @module weft-core/store/resume
 * @description `resume()` — replay a prior run from its durable journal (CR-403).
 *
 *   WHAT `resume()` DOES:
 *   Calls `unit.run()` with the durable idempotency store and `runId` as the
 *   outer idempotency key. If `runId` is already in the store (the whole run
 *   committed), the unit returns its cached result without executing any steps.
 *   If `runId` is absent, the unit executes from scratch.
 *
 *   WHAT `resume()` DOES NOT DO — the critical constraint:
 *   `resume()` does NOT automatically skip sub-steps inside the unit. An
 *   ordinary composed unit (a `flatMap`, `zip`, or any operator that does not
 *   pass explicit `idempotency` options to each internal step) re-executes
 *   every step whenever the outer `runId` is absent.
 *
 *   Per-step skipping applies only when ALL of the following hold:
 *     1. Each sub-step was run with an explicit
 *        `idempotency: { key: \`${runId}:stepN\`, strategy: "return-cached", store }`
 *        option during the original run.
 *     2. The same durable `store` (or one backed by the same backend) is
 *        supplied to `resume()` and to each sub-step's `run()` call.
 *   Without both conditions the sub-step re-executes on every resume attempt
 *   regardless of any keys that exist in the store.
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
 * Replay a prior run from its durable journal.
 *
 * Skips the entire unit if `runId` is committed in the store. Per-step
 * skipping is NOT automatic: it applies only to sub-steps that were each
 * run with an explicit `idempotency: { key: \`${runId}:stepN\` }` option
 * during the original run. An ordinary composed unit (`flatMap`, `zip`, etc.)
 * re-executes all its steps when the outer `runId` is absent. See the
 * module docstring for the full contract.
 *
 * @example
 * ```typescript
 * import { resume, createDurableStore, createFileBackend } from "weft-core/store";
 *
 * const store = createDurableStore(createFileBackend("./.weft-journal"));
 *
 * // Each sub-step MUST pass its own idempotency option for step-level skipping:
 * const unit = AgentUnit.from(async (ctx) => {
 *   const r1 = await step1.run(ctx, {
 *     idempotency: { key: `${runId}:step1`, strategy: "return-cached", store: store.idempotency },
 *   });
 *   return r1.value;
 * });
 *
 * // Resume: whole-unit cache hit returns immediately; otherwise runs with
 * // per-step skipping for any step whose key is already committed.
 * const result = await resume(runId, unit, createContext(), { store });
 * ```
 *
 * @param runId   Stable identifier for the original run. Used as the outer
 *                idempotency key. Per-step keys, if any, must be constructed
 *                by agent code itself (e.g. `\`${runId}:stepN\``).
 * @param unit    The `AgentUnit` to execute (same unit as the original run).
 * @param context `AgentContext` for the resumed execution. The durable store is
 *                injected into `context.extensions.__weft_resume_store` so
 *                agent code that checks for it can access the store directly.
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

  // Run the unit with the outer idempotency key. If runId is cached, the
  // whole unit returns immediately. If not, the unit executes; sub-steps are
  // skipped only if they were each run with an explicit per-step idempotency
  // option — ordinary composed units (flatMap, zip) do NOT skip automatically.
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
