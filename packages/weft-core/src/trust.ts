/**
 * @module weft-core/trust
 * @description Zero-trust provenance layer. Uses a module-private WeakSet to
 *   track authentic TrackedResult objects — the marker Symbol is deliberately
 *   NOT exported AND the registry prevents forgery via
 *   Object.getOwnPropertySymbols() extraction from genuine results.
 *
 *   The ONLY way to create a TrackedResult that passes isTrackedResult() is
 *   through createTrackedResult(). Objects constructed manually — even with
 *   a leaked marker Symbol — will NOT be in the WeakSet and will be rejected.
 *
 *   Also provides serialize/deserialize for durable storage (CR-403). Deserialized
 *   results are re-registered in the WeakSet via createTrackedResult() — they pass
 *   isTrackedResult() after deserialization.
 *
 * @since 2.1.0 — Hardened against forgery (Codex FATAL #1, 2026-07-07)
 */
import type { ObjectiveConfidence } from "./confidence";
import type { EnsembleCoherence } from "./coherence/types";
import type { ResultSource, TrackedResult } from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// PRIVATE REGISTRY — never exported, never leaked
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Private Symbol marker for TrackedResult authenticity.
 * Deliberately NOT exported. Even if extracted from a genuine result via
 * Object.getOwnPropertySymbols(), the extracted marker won't help because
 * the WeakSet registry is the true authority.
 */
const TRACKED_MARKER: unique symbol = Symbol("__Weft_tracked__");

/**
 * Private WeakSet registry of all genuine TrackedResult objects.
 * A forged object is NOT in this set regardless of what Symbols it carries.
 * WeakSet ensures entries are GC'd when the TrackedResult is no longer referenced.
 */
const _trackedRegistry = new WeakSet<object>();

// ─────────────────────────────────────────────────────────────────────────────
// FACTORY — the only code path that creates TrackedResult objects
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create a genuine TrackedResult. This is the ONLY way to construct a
 * TrackedResult that will pass isTrackedResult(). Both the marker Symbol
 * AND the WeakSet registry must align.
 */
export function createTrackedResult<T>(
  value: T,
  metadata: {
    source: ResultSource;
    confidence: number;
    sourceChain?: ResultSource[];
    minChainConfidence?: number;
    verifiedBy?: string;
    verifiedAt?: number;
    objectiveConfidence?: ObjectiveConfidence;
    /** Ensemble coherence from multi-agent operators. CR-503. */
    coherence?: EnsembleCoherence;
  },
): TrackedResult<T> {
  const result: TrackedResult<T> = {
    [TRACKED_MARKER]: true as const,
    value,
    source: metadata.source,
    confidence: metadata.confidence,
    sourceChain: metadata.sourceChain ?? [metadata.source],
    minChainConfidence: metadata.minChainConfidence ?? metadata.confidence,
  };

  if (metadata.verifiedBy) result.verifiedBy = metadata.verifiedBy;
  if (metadata.verifiedAt) result.verifiedAt = metadata.verifiedAt;
  if (metadata.objectiveConfidence)
    result.objectiveConfidence = metadata.objectiveConfidence;
  if (metadata.coherence) result.coherence = metadata.coherence;

  // Register in the WeakSet — the true unforgeable authority
  _trackedRegistry.add(result);

  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// GUARD — checks BOTH the marker AND the registry
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Type guard: returns true ONLY for objects created by createTrackedResult().
 *
 * Checks TWO conditions:
 * 1. The private TRACKED_MARKER Symbol is present (fast pre-check)
 * 2. The object is in the WeakSet registry (defeats marker extraction attacks)
 *
 * An attacker who extracts the marker via Object.getOwnPropertySymbols()
 * will fail condition 2 because their forged object was never added to
 * the WeakSet.
 */
export function isTrackedResult<T>(
  value: unknown,
): value is TrackedResult<T> {
  if (value === null || typeof value !== "object") return false;
  // Both conditions must be true — marker alone is insufficient
  return (
    TRACKED_MARKER in (value as Record<symbol, unknown>) &&
    _trackedRegistry.has(value)
  );
}

/**
 * Unwrap a TrackedResult, returning its inner value.
 * Throws if the argument is not a genuine TrackedResult.
 */
export function unwrapTrackedResult<T>(result: TrackedResult<T>): T {
  if (!isTrackedResult(result)) {
    throw new TypeError(
      "unwrapTrackedResult: argument is not a genuine TrackedResult",
    );
  }
  return result.value;
}

/**
 * Extract confidence from a TrackedResult, validating authenticity first.
 * Returns undefined if the value is not a genuine TrackedResult.
 */
export function extractTrackedConfidence(value: unknown): number | undefined {
  if (!isTrackedResult(value)) return undefined;
  return value.confidence;
}

// ─────────────────────────────────────────────────────────────────────────────
// DURABLE SERIALIZATION (CR-403)
//
// Serialize/deserialize round-trips through durable storage. Deserialization
// calls createTrackedResult() so the result re-enters the WeakSet and passes
// isTrackedResult() after load.
//
// WHAT IS NOT SERIALIZED:
//   • The private TRACKED_MARKER symbol (re-created on deserialize)
//   • Any prompt or response text from the computation (telemetry safety)
//   • Anything not listed in SerializedTrackedResult below
//
// GUARANTEE BOUNDARY (unchanged from IdempotencyStore):
//   If backend.set() fails after a side effect ran, no journal entry exists
//   and the side effect may execute again on resume. Making the side effect
//   itself idempotent is the only way to close this gap — this layer cannot.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * JSON-serializable snapshot of a TrackedResult for durable storage.
 *
 * @remarks
 * Excludes the private marker Symbol and the WeakSet registration — both
 * are re-created when you pass this to {@link deserializeTrackedResult}.
 * Never serialize raw prompt/response text into the journal; store metadata only.
 */
export interface SerializedTrackedResult<T> {
  value: T;
  source: ResultSource;
  confidence: number;
  sourceChain: ResultSource[];
  minChainConfidence: number;
  verifiedBy?: string;
  verifiedAt?: number;
  objectiveConfidence?: ObjectiveConfidence;
  coherence?: EnsembleCoherence;
}

/**
 * Serialize a genuine TrackedResult for durable storage.
 *
 * Throws if `result` is not a genuine TrackedResult (i.e. isTrackedResult fails).
 * This prevents storing forged or stale results under an idempotency key.
 */
export function serializeTrackedResult<T>(
  result: TrackedResult<T>,
): SerializedTrackedResult<T> {
  if (!isTrackedResult(result)) {
    throw new TypeError(
      "serializeTrackedResult: argument is not a genuine TrackedResult. " +
        "Only results created by createTrackedResult() can be serialized.",
    );
  }
  const out: SerializedTrackedResult<T> = {
    value: result.value,
    source: result.source,
    confidence: result.confidence,
    sourceChain: result.sourceChain ?? [result.source],
    minChainConfidence: result.minChainConfidence ?? result.confidence,
  };
  if (result.verifiedBy !== undefined) out.verifiedBy = result.verifiedBy;
  if (result.verifiedAt !== undefined) out.verifiedAt = result.verifiedAt;
  if (result.objectiveConfidence !== undefined)
    out.objectiveConfidence = result.objectiveConfidence;
  if (result.coherence !== undefined) out.coherence = result.coherence;
  return out;
}

/**
 * Reconstruct a genuine TrackedResult from a serialized snapshot.
 *
 * The result is registered in the WeakSet via createTrackedResult() and
 * will pass isTrackedResult() immediately after this call returns.
 */
export function deserializeTrackedResult<T>(
  serialized: SerializedTrackedResult<T>,
): TrackedResult<T> {
  return createTrackedResult(serialized.value, {
    source: serialized.source,
    confidence: serialized.confidence,
    sourceChain: serialized.sourceChain,
    minChainConfidence: serialized.minChainConfidence,
    verifiedBy: serialized.verifiedBy,
    verifiedAt: serialized.verifiedAt,
    objectiveConfidence: serialized.objectiveConfidence,
    coherence: serialized.coherence,
  });
}
