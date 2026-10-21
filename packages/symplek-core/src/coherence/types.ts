/**
 * @fileoverview Coherence Type Definitions
 * @description Type definitions for ensemble coherence measurement
 * @module @symplek/core/coherence/types
 * @since 2.1.0
 *
 * 📝 BUILD[STORY-01.01]: Core type definitions for coherence calculations
 */

import type { Vote } from "../types";

// ─────────────────────────────────────────────────────────────────────────────
// COHERENCE SIGNAL
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Individual coherence signal from a calculation method.
 */
export interface CoherenceSignal {
  /** Coherence value [0, 1] */
  value: number;
  /** Method that produced this signal */
  method: CoherenceMethod;
  /** Weight in composite calculation */
  weight: number;
  /** Human-readable formula */
  formula: string;
  /** Raw inputs for audit */
  inputs: Record<string, unknown>;
}

/**
 * Coherence calculation methods.
 */
export type CoherenceMethod =
  | "agreement" // From existing agreementRate
  | "variance" // From vote confidence spread
  | "entropy" // From decision distribution
  | "convergence" // From converge/debate rounds
  | "stigmergy"; // Future: pheromone trails

// ─────────────────────────────────────────────────────────────────────────────
// ENSEMBLE COHERENCE RESULT
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Complete coherence assessment result.
 */
export interface EnsembleCoherence {
  /** Agreement-based coherence */
  agreementCoherence: number;

  /** Variance-based coherence */
  varianceCoherence: number;

  /** Entropy-based coherence */
  entropyCoherence: number;

  /** Convergence-based coherence (if available) */
  convergenceCoherence?: number;

  /** Stigmergic coherence (future) */
  stigmergyCoherence?: number;

  /** Final composite score */
  composite: number;

  /** Audit metadata */
  metadata: CoherenceMetadata;
}

// ─────────────────────────────────────────────────────────────────────────────
// METADATA
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Audit trail for coherence calculations.
 */
export interface CoherenceMetadata {
  /** Timestamp of calculation */
  calculatedAt: number;
  /** Methods that contributed to composite */
  contributingMethods: CoherenceMethod[];
  /** Weights used in calculation */
  weights: CoherenceWeights;
  /** Human-readable composite formula */
  formula: string;
  /** Individual signals for audit */
  signals: CoherenceSignal[];
  /** Algorithm version for reproducibility */
  algorithmVersion: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// CONFIGURATION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Weight configuration for composite calculation.
 * All weights should sum to 1.0 for interpretable results.
 */
export interface CoherenceWeights {
  /** Agreement weight (default: 0.40) - most direct measure of consensus */
  agreement: number;
  /** Variance weight (default: 0.25) - confidence consistency */
  variance: number;
  /** Entropy weight (default: 0.15) - decision distribution */
  entropy: number;
  /** Convergence weight (default: 0.15) - iterative refinement signal */
  convergence: number;
  /** Stigmergy weight (default: 0.05) - pheromone trail signal (future) */
  stigmergy: number;
}

/**
 * Threshold presets for different risk levels.
 */
export interface CoherenceThresholds {
  /** Near-unanimous (>= 0.95) - for critical decisions */
  critical: number;
  /** High-stakes (>= 0.80) - for important decisions */
  highStakes: number;
  /** Standard operations (>= 0.70) - for normal operations */
  standard: number;
  /** Byzantine fault tolerance minimum (>= 0.67) - 2/3 + 1 rule */
  byzantine: number;
}

/**
 * Named threshold presets.
 */
export type CoherencePreset =
  | "critical"
  | "highStakes"
  | "standard"
  | "byzantine";

// ─────────────────────────────────────────────────────────────────────────────
// TYPE GUARDS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Type for multi-agent results with votes.
 */
export interface HasVotes {
  votes: Vote[];
}

/**
 * Type for debate/converge results with contributions.
 */
export interface HasContributions {
  contributions: Array<{ round: number; agentId: string; hadMore?: boolean }>;
}

/**
 * Type guard for multi-agent results with votes.
 *
 * @param value - Value to check
 * @returns True if value has a votes array
 */
export function hasVotes(value: unknown): value is HasVotes {
  return (
    typeof value === "object" &&
    value !== null &&
    "votes" in value &&
    Array.isArray((value as HasVotes).votes)
  );
}

/**
 * Type guard for debate/converge results with contributions.
 *
 * @param value - Value to check
 * @returns True if value has a contributions array
 */
export function hasContributions(value: unknown): value is HasContributions {
  return (
    typeof value === "object" &&
    value !== null &&
    "contributions" in value &&
    Array.isArray((value as HasContributions).contributions)
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// INPUT/OUTPUT TYPES
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Input for coherence calculation.
 */
export interface CoherenceInput {
  /** Votes from consensus/debate operations */
  votes?: Vote[];
  /** Contributions from converge/debate operations */
  contributions?: Array<{ round: number; agentId: string; hadMore?: boolean }>;
  /** Number of convergence rounds completed */
  convergenceRounds?: number;
}

/**
 * Options for coherence calculation.
 */
export interface CoherenceCalculationOptions {
  /** Custom weights (partial - unspecified weights use defaults) */
  weights?: Partial<CoherenceWeights>;
  /** Named preset (overrides threshold if provided) */
  preset?: CoherencePreset;
}
