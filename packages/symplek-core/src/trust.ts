/**
 * @module @symplek/core/trust
 * @description Zero-trust provenance layer. Uses a module-private WeakSet to
 *   track authentic TrackedResult objects — the marker Symbol is deliberately
 *   NOT exported AND the registry prevents forgery via
 *   Object.getOwnPropertySymbols() extraction from genuine results.
 *
 *   The ONLY way to create a TrackedResult that passes isTrackedResult() is
 *   through createTrackedResult(). Objects constructed manually — even with
 *   a leaked marker Symbol — will NOT be in the WeakSet and will be rejected.
 *
 * @since 1.0.0-beta.1 — Hardened against forgery (Codex FATAL #1, 2026-07-07)
 */
import type { ObjectiveConfidence } from "./confidence";
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
const TRACKED_MARKER: unique symbol = Symbol("__Symplek_tracked__");

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
