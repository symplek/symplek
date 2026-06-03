/**
 * @module weft-core/operators/sourceTracking
 * @description Source tracking operator: wraps computation results with provenance metadata.
 * @blast_radius LOW
 * @status STABLE
 */

import type { AgentComputation, AgentUnitMetadata } from "../AgentUnit";
import type {
  AgentContext,
  SourceTrackingOptions,
  TrackedResult,
} from "../types";
import { TRACKED_MARKER } from "../types";

/**
 * Creates a computation that wraps results with source tracking metadata.
 */
export function createTrackedComputation<T>(
  innerComputation: AgentComputation<T>,
  _innerMeta: AgentUnitMetadata,
  options: SourceTrackingOptions,
): AgentComputation<TrackedResult<T>> {
  const { source, confidence, verifiedBy } = options;

  // Validate confidence
  if (typeof confidence !== "number" || !Number.isFinite(confidence)) {
    throw new Error(
      `tracked(): confidence must be a finite number, got ${confidence}`,
    );
  }
  if (confidence < 0 || confidence > 1) {
    throw new Error(
      `tracked(): confidence must be between 0 and 1, got ${confidence}`,
    );
  }

  return async (ctx: AgentContext): Promise<TrackedResult<T>> => {
    const value = await innerComputation(ctx);

    return {
      [TRACKED_MARKER]: true,
      value,
      source,
      confidence,
      verifiedBy: source === "verified" ? verifiedBy : undefined,
      verifiedAt: source === "verified" ? Date.now() : undefined,
      sourceChain: [source],
      minChainConfidence: confidence,
    };
  };
}
