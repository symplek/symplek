/**
 * @module AgentUnit/metadata
 * @description AgentUnit metadata types, computation type, ID generation, and confidence constants.
 *   Extracted to break circular imports between the class shell and helper modules.
 * @blast_radius HIGH - All AgentUnit files depend on this module.
 * @status STABLE
 * @runtime node
 * @surface internal
 */

import type { AgentContext } from "../types";
import type { EnsembleCoherence } from "../coherence/types";

// ─────────────────────────────────────────────────────────────────────────────
// COMPUTATION TYPE
// ─────────────────────────────────────────────────────────────────────────────

/** A lazy computation that produces a value T using an AgentContext. */
export type AgentComputation<T> = (ctx: AgentContext) => Promise<T>;

// ─────────────────────────────────────────────────────────────────────────────
// METADATA
// ─────────────────────────────────────────────────────────────────────────────

/** Metadata attached to an AgentUnit for debugging and tracing. */
export interface AgentUnitMetadata {
  /** Unique identifier for this computation */
  id: string;
  /** Chain of operators applied (e.g., ['map', 'flatMap', 'zip']) */
  operatorChain: string[];
  /** Whether this unit involves sequential operations */
  isSequential?: boolean;
  /** Whether this unit involves parallel operations */
  isParallel?: boolean;
  /** Creation timestamp */
  createdAt: number;
  /**
   * Coherence propagated from an upstream coordination operator (consensus,
   * converge, debate) through a downstream map() transform. Coordination
   * operators attach coherence to their result VALUE; map() captures it here
   * before applying the transform function so wrapInTrackedResult() can place
   * it on the resulting TrackedResult even when the mapped value (e.g. a plain
   * string) carries no coherence field of its own.
   *
   * Set only when map() observes upstream coherence. flatMap() does NOT
   * propagate this field because the downstream computation is independent.
   */
  coherence?: EnsembleCoherence;
}

// ─────────────────────────────────────────────────────────────────────────────
// ID GENERATION
// ─────────────────────────────────────────────────────────────────────────────

/** Generate a unique ID for an AgentUnit. */
export function generateId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 10);
  return `au_${timestamp}_${random}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// CONFIDENCE CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

/** Base confidence for agent-generated results. */
export const BASE_CONFIDENCE = 0.85;

/**
 * Confidence adjustments per operator type.
 * Positive = increases trust, negative = decreases trust.
 */
export const CONFIDENCE_ADJUSTMENTS: Record<string, number> = {
  consensus: 0.1, // Multiple agents agreed
  challenge: 0.05, // Thesis/antithesis considered
  verify: 0.15, // Human verification
  retry: -0.05, // Indicates uncertainty
  fallback: -0.1, // Primary failed
  converge: 0.15, // All agents explicitly said "I'm done"
  debate: 0.15, // Unanimous agreement (converge + consensus)
  dialectic: 0.1, // Leader-driven synthesis with advisor input
};
