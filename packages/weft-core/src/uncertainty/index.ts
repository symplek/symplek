/**
 * @module weft-core/uncertainty
 * @description Typed uncertainty as a first-class exportable output (CR-503).
 *
 *   Promotes `ObjectiveConfidence` and `EnsembleCoherence` from internal scoring
 *   utilities to a composable signal that rides on `TrackedResult`, threads through
 *   operators, and exports as OpenTelemetry `gen_ai.weft.*` attributes.
 *
 *   No `@opentelemetry/*` peer dependency required: both functions return plain
 *   `Record<string, string | number | boolean>`, usable with any OTel SDK.
 *
 * @example
 * ```typescript
 * import { getUncertainty, uncertaintySpanAttributes } from "weft-core/uncertainty";
 *
 * const result = await AgentUnit.of(task).consensus(voters).run(ctx);
 *
 * const signal = getUncertainty(result);
 * // signal.composite        → 0.87
 * // signal.isHighConfidence → true
 * // signal.confidence.agreementRate → 0.92
 *
 * const attrs = uncertaintySpanAttributes(result);
 * // attrs["gen_ai.weft.confidence.composite"] → 0.87  (number, not string)
 * // attrs["gen_ai.weft.uncertainty.source"]   → "agent"
 * ```
 *
 * @since 2.1.0 — CR-503
 */

import type { EnsembleCoherence } from "../coherence/types";
import { CONFIDENCE_THRESHOLDS } from "../confidence/config";
import type { ObjectiveConfidence } from "../confidence/types";
import type { TrackedResult } from "../types";

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC TYPES
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Unified uncertainty signal for a `TrackedResult`.
 *
 * @remarks
 * `composite` is always present: it equals `objectiveConfidence.composite` when
 * the result was produced by a coordination operator that computed objective
 * confidence, and falls back to the scalar `confidence` field otherwise.
 *
 * `isHighConfidence` and `isLowConfidence` are computed against
 * `CONFIDENCE_THRESHOLDS` (high = 0.8, low = 0.5). They are mutually exclusive
 * only when `composite` is in range (0.5..0.8]; at exactly the boundaries the
 * booleans are also mutually exclusive.
 */
export interface UncertaintySignal {
  /**
   * Primary composite score [0–1].
   * Equal to `objectiveConfidence.composite` when available, `confidence` otherwise.
   */
  composite: number;

  /**
   * Mathematically computed confidence from observable behavior (agreement rate,
   * entropy, variance, retry count). Present when produced by a voting operator.
   */
  confidence?: ObjectiveConfidence;

  /**
   * Ensemble coherence from a multi-agent operator (consensus, converge, debate).
   * Present when the result was produced by one of those operators.
   */
  coherence?: EnsembleCoherence;

  /** `composite >= CONFIDENCE_THRESHOLDS.high` (0.8). */
  isHighConfidence: boolean;

  /** `composite < CONFIDENCE_THRESHOLDS.low` (0.5). */
  isLowConfidence: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// EXTRACTION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Extract the uncertainty signal from a `TrackedResult`.
 *
 * The `composite` score uses `objectiveConfidence.composite` when available
 * (populated by voting operators), falling back to the scalar `confidence`
 * field which is always present.
 *
 * @example
 * ```typescript
 * const signal = getUncertainty(result);
 * if (signal.isLowConfidence) {
 *   // escalate to human review
 * }
 * ```
 */
export function getUncertainty(
  result: TrackedResult<unknown>,
): UncertaintySignal {
  const composite =
    result.objectiveConfidence?.composite ?? result.confidence;

  return {
    composite,
    confidence: result.objectiveConfidence,
    coherence: result.coherence,
    isHighConfidence: composite >= CONFIDENCE_THRESHOLDS.high,
    isLowConfidence: composite < CONFIDENCE_THRESHOLDS.low,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// OTEL ATTRIBUTE MAPPING
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Map a `TrackedResult`'s uncertainty to OpenTelemetry `gen_ai.weft.*` attributes.
 *
 * Returns a plain `Record<string, string | number | boolean>` with no OTel SDK
 * dependency. Pair with `genAiSpanAttributes()` from `weft-core` for full span
 * coverage.
 *
 * **Emitted keys** (all optional, present only when data exists):
 * - `gen_ai.weft.confidence.composite`   — number  (always present)
 * - `gen_ai.weft.uncertainty.source`     — string  (always present)
 * - `gen_ai.weft.confidence.agreement_rate` — number
 * - `gen_ai.weft.confidence.entropy`     — number
 * - `gen_ai.weft.confidence.variance`    — number
 * - `gen_ai.weft.confidence.retry`       — number
 * - `gen_ai.weft.coherence.composite`    — number  (when coherence present)
 *
 * **OTel safety**: attribute values are scores and metadata only — never prompt
 * or response text, which would violate the repair-campaign telemetry safety rule.
 *
 * @example
 * ```typescript
 * span.setAttributes(genAiSpanAttributes(entry));
 * span.setAttributes(uncertaintySpanAttributes(result));
 * ```
 */
export function uncertaintySpanAttributes(
  result: TrackedResult<unknown>,
): Record<string, string | number | boolean> {
  const composite =
    result.objectiveConfidence?.composite ?? result.confidence;

  const out: Record<string, string | number | boolean> = {
    "gen_ai.weft.confidence.composite": composite,
    "gen_ai.weft.uncertainty.source": result.source as string,
  };

  if (result.objectiveConfidence) {
    const c = result.objectiveConfidence;
    out["gen_ai.weft.confidence.agreement_rate"] = c.agreementRate;
    out["gen_ai.weft.confidence.entropy"] = c.entropyConfidence;
    out["gen_ai.weft.confidence.variance"] = c.varianceConfidence;
    out["gen_ai.weft.confidence.retry"] = c.retryConfidence;
  }

  if (result.coherence) {
    out["gen_ai.weft.coherence.composite"] = result.coherence.composite;
  }

  return out;
}
