/**
 * @module AgentUnit/zeroTrust
 * @description Standalone zero-trust helper functions extracted from AgentUnit class.
 *   Handles confidence calculation, result wrapping, and deprecation warnings.
 * @blast_radius MEDIUM
 * @status STABLE
 * @runtime node
 * @surface internal
 */

import type { EnsembleCoherence } from "../coherence/types";
import type { ObjectiveConfidence } from "../confidence";
import { createTrackedResult } from "../trust";
import type { ResultSource, TrackedResult } from "../types";
import {
  type AgentUnitMetadata,
  BASE_CONFIDENCE,
  CONFIDENCE_ADJUSTMENTS,
} from "./metadata";

/**
 * Emit deprecation warning for legacy mode. Only emits once per process.
 * State is owned by the `AgentUnit.#deprecationWarned` private static field.
 * Tests reset it via `AgentUnit.resetDeprecationWarningForTesting()`.
 * @param cls - The AgentUnit class (provides `_getAndSetDeprecationWarned`)
 */
export function emitDeprecationWarning(cls: {
  _getAndSetDeprecationWarned(): boolean;
}): void {
  const alreadyWarned = cls._getAndSetDeprecationWarned();
  if (!alreadyWarned) {
    console.warn(
      '[Symplek] trustMode: "legacy" is deprecated and will be removed in v3.0.\n' +
        "  Use the default mode instead: unit.run(ctx) returns { value, source, confidence }.",
    );
  }
}

/** Calculate confidence score based on operators in the chain. */
export function calculateConfidence(operatorChain: string[]): number {
  let confidence = BASE_CONFIDENCE;
  for (const operator of operatorChain) {
    const adjustment = CONFIDENCE_ADJUSTMENTS[operator];
    if (adjustment !== undefined) {
      confidence += adjustment;
    }
  }
  return Math.max(0, Math.min(1, confidence));
}

/** Extract objective confidence from a value if it has one. */
export function extractObjectiveConfidence<T>(
  value: T,
): ObjectiveConfidence | undefined {
  if (
    value !== null &&
    typeof value === "object" &&
    "objectiveConfidence" in value &&
    (value as Record<string, unknown>).objectiveConfidence !== undefined
  ) {
    return (value as Record<string, unknown>)
      .objectiveConfidence as ObjectiveConfidence;
  }
  return undefined;
}

/**
 * Extract ensemble coherence from a value if it carries one.
 * Coordination operators (consensus, converge, debate) attach a `coherence`
 * field to their raw result objects before they reach wrapInTrackedResult().
 * The field is validated structurally to avoid treating unrelated `coherence`
 * properties (e.g. a numeric `coherence` on a domain object) as EnsembleCoherence.
 */
export function extractCoherence<T>(value: T): EnsembleCoherence | undefined {
  if (value === null || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  if (!("coherence" in record)) return undefined;
  const c = record.coherence;
  if (
    c !== null &&
    typeof c === "object" &&
    "composite" in (c as Record<string, unknown>) &&
    typeof (c as Record<string, unknown>).composite === "number"
  ) {
    return c as EnsembleCoherence;
  }
  return undefined;
}

/** Wrap a raw value in a TrackedResult with source metadata. */
export function wrapInTrackedResult<T>(
  metadata: AgentUnitMetadata,
  value: T,
): TrackedResult<T> {
  const confidence = calculateConfidence(metadata.operatorChain);
  const source: ResultSource = "agent";
  const objectiveConfidence = extractObjectiveConfidence(value);
  // Fall back to coherence captured by map() when the (transformed) value
  // carries none of its own. This is the R3-4 propagation path: a consensus
  // result piped through .map(() => "done") loses the structured value but
  // the map() operator stored the upstream coherence in metadata.coherence.
  const coherence = extractCoherence(value) ?? metadata.coherence;

  return createTrackedResult(value, {
    source,
    confidence,
    sourceChain: [source],
    minChainConfidence: confidence,
    objectiveConfidence,
    coherence,
  });
}
