/**
 * @module weft-core/operators/reflect
 * @description Reflect operator: recursive self-review — critique, optional structured
 *   verification, and optional bounded improvement of a computation's output.
 * @blast_radius MEDIUM
 * @status STABLE
 */

import type { AgentComputation } from "../AgentUnit";
import type {
  AgentContext,
  ReflectAgent,
  ReflectOptions,
  ReflectResult,
  ReflectVerifierFeedback,
} from "../types";

/**
 * Hard ceiling on reflection passes regardless of the requested `maxDepth`.
 * Guards against runaway recursive self-review loops.
 */
export const REFLECT_MAX_DEPTH = 10;

/** Default number of reflection passes when `maxDepth` is not supplied. */
const REFLECT_DEFAULT_MAX_DEPTH = 1;

/**
 * Sentinel critique emitted by the built-in structural self-check when the
 * output looks healthy. Recognised by {@link defaultVerify} as "no issues".
 */
const NO_ISSUES_CRITIQUE = "No structural issues detected in output.";

/** Confidence baseline when critique is disabled (no review performed). */
const NO_CRITIQUE_CONFIDENCE = 0.7;

function clamp01(value: number): number {
  if (Number.isNaN(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

/**
 * Resolve a {@link ReflectAgent} result, which may be an AgentUnit, a Promise,
 * or a raw value — mirroring the convergent-agent resolution in converge.ts.
 * Internal AgentUnit runs use `trustMode: 'legacy'` to avoid double-wrapping.
 */
async function resolveReflectAgent<I, O>(
  agent: ReflectAgent<I, O>,
  input: I,
  ctx: AgentContext,
): Promise<O> {
  const result = agent(input);
  if (result && typeof (result as { run?: unknown }).run === "function") {
    const unit = result as import("../AgentUnit").AgentUnit<O>;
    return (await unit.run(ctx)).value;
  }
  if (result instanceof Promise) {
    return result;
  }
  return result as O;
}

/** True when a value is empty/missing in the structural sense. */
function isEmptyLike(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === "string") return value.trim().length === 0;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === "object") return Object.keys(value).length === 0;
  return false;
}

/**
 * Deterministic critique used when no `critiqueAgent` is supplied. Performs a
 * structural self-check only — never calls an LLM.
 */
function defaultCritique<T>(output: T): string {
  if (isEmptyLike(output)) {
    return "Output is empty or missing; expected a populated result.";
  }
  return NO_ISSUES_CRITIQUE;
}

/**
 * Heuristic verifier used when no `verifierAgent` is supplied. Treats the
 * sentinel critique as approval and any other critique as a single issue.
 */
function defaultVerify(critique: string): ReflectVerifierFeedback {
  if (critique === NO_ISSUES_CRITIQUE) {
    return { issues: [], approved: true, confidence: 0.9 };
  }
  return { issues: [critique], approved: false, confidence: 0.4 };
}

/**
 * Derive a 0..1 confidence from verifier feedback. Honours an explicit
 * `confidence` when the verifier reports one; otherwise penalises per issue.
 */
function computeConfidence(feedback: ReflectVerifierFeedback): number {
  const issues = feedback.issues ?? [];
  const approved = feedback.approved ?? issues.length === 0;
  if (typeof feedback.confidence === "number") {
    return clamp01(feedback.confidence);
  }
  if (approved) return 0.9;
  return clamp01(0.6 - 0.1 * issues.length);
}

/**
 * Creates a computation that recursively self-reviews the inner computation's
 * output.
 *
 * @remarks
 * The reflect operator NEVER calls an LLM itself. It executes `inner` once to
 * obtain the output, then orchestrates caller-supplied agents (critique,
 * verifier, improve) — each of which is the caller's own compute()/LLM call.
 *
 * Cycle (bounded by `maxDepth`, hard-capped at {@link REFLECT_MAX_DEPTH}):
 * 1. Run `inner` → the original output.
 * 2. If `critique`: produce critique text (critiqueAgent, else structural check).
 * 3. Run the critique through the verifier → structured feedback (issues + confidence).
 * 4. If `improve` AND issues found AND an `improveAgent` is supplied: produce an
 *    improved output from `{ original, critique }`, then reflect again on it.
 * 5. Stop when the verifier approves, when improvement is unavailable, or at maxDepth.
 *
 * @param inner - The computation whose output is reflected upon.
 * @param options - Reflect configuration options.
 * @returns A computation that produces a {@link ReflectResult}.
 *
 * ⚠️ CAUTION: `maxDepth` is clamped to [1, 10] to prevent infinite self-review.
 */
export function createReflectComputation<T>(
  inner: AgentComputation<T>,
  options: ReflectOptions<T> = {},
): AgentComputation<ReflectResult<T>> {
  const critiqueEnabled = options.critique ?? true;
  const improveEnabled = options.improve ?? false;
  const maxDepth = Math.min(
    Math.max(1, Math.floor(options.maxDepth ?? REFLECT_DEFAULT_MAX_DEPTH)),
    REFLECT_MAX_DEPTH,
  );

  return async (ctx: AgentContext): Promise<ReflectResult<T>> => {
    const original = await inner(ctx);

    // Critique disabled: nothing to review, return a neutral-high confidence.
    if (!critiqueEnabled) {
      return {
        original,
        confidence: NO_CRITIQUE_CONFIDENCE,
        depth: 0,
      };
    }

    let current = original;
    let critique: string | undefined;
    let verifierFeedback: ReflectVerifierFeedback | undefined;
    let improved: T | undefined;
    let confidence = NO_CRITIQUE_CONFIDENCE;
    let depth = 0;

    for (let pass = 1; pass <= maxDepth; pass++) {
      depth = pass;

      // 2. Critique the current output.
      const passCritique = options.critiqueAgent
        ? await resolveReflectAgent(options.critiqueAgent, current, ctx)
        : defaultCritique(current);
      critique = passCritique;

      // 3. Verify the critique into structured feedback.
      const feedback = options.verifierAgent
        ? await resolveReflectAgent(options.verifierAgent, passCritique, ctx)
        : defaultVerify(passCritique);
      verifierFeedback = feedback;

      const issues = feedback.issues ?? [];
      const approved = feedback.approved ?? issues.length === 0;
      confidence = computeConfidence(feedback);

      // 4. Improve only when issues remain and an improver is available.
      const canImprove =
        improveEnabled &&
        !approved &&
        issues.length > 0 &&
        options.improveAgent !== undefined;

      if (canImprove) {
        // `options.improveAgent` is defined here (guarded above).
        const next = await resolveReflectAgent(
          options.improveAgent as ReflectAgent<
            { original: T; critique: string },
            T
          >,
          { original: current, critique: passCritique },
          ctx,
        );
        improved = next;
        current = next; // reflect on the improved output next pass
        continue;
      }

      // Approved, or no improvement path — stop early.
      break;
    }

    return {
      original,
      critique,
      verifierFeedback,
      improved,
      confidence,
      depth,
    };
  };
}
