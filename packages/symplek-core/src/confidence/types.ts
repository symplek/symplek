/**
 * @fileoverview Objective Confidence Type Definitions
 * @description Core type definitions for mathematically computed confidence scoring
 * @module @symplek/core/confidence/types
 * @since 1.0.0-beta.1
 *
 * 📝 BUILD[01.02]: Objective confidence types from research findings
 */

import type { Vote } from "../types";

// ─────────────────────────────────────────────────────────────────────────────
// CONFIDENCE SIGNAL TYPES
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Individual confidence signal from a single calculation tier.
 *
 * @remarks
 * Each tier produces a ConfidenceSignal with its computed value,
 * contributing factor weight, and metadata for audit trails.
 */
export interface ConfidenceSignal {
  /** Confidence value (0-1) */
  value: number;
  /** Tier that produced this signal */
  tier: ConfidenceTier;
  /** Weight applied to this signal in composite calculation */
  weight: number;
  /** How this value was calculated */
  formula: string;
  /** Raw inputs used in calculation */
  inputs: Record<string, unknown>;
}

/**
 * Tier levels for confidence calculation.
 *
 * @remarks
 * Tiers represent increasing complexity of calculation:
 * - Tier 1 (Immediate): Simple agreement rate - instant calculation
 * - Tier 2 (Statistical): Entropy/variance - requires distribution analysis
 * - Tier 3 (Behavioral): Retry patterns - requires execution history
 * - Tier 4 (Bayesian): Prior integration - requires historical context
 */
export type ConfidenceTier = 1 | 2 | 3 | 4;

/**
 * Named tier identifiers for configuration.
 */
export type TierName = "immediate" | "statistical" | "behavioral" | "bayesian";

// ─────────────────────────────────────────────────────────────────────────────
// OBJECTIVE CONFIDENCE RESULT
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Complete objective confidence assessment result.
 *
 * @remarks
 * This is the primary output type. Unlike LLM self-reported confidence,
 * every value here is mathematically computed from observable behavior.
 *
 * @example
 * ```typescript
 * const result = calculateObjectiveConfidence({
 *   votes: consensusVotes,
 *   retryCount: 2,
 * });
 *
 * console.log(result.composite); // 0.87 - weighted combination
 * console.log(result.metadata.formula); // Shows exact calculation
 * ```
 */
export interface ObjectiveConfidence {
  // ─── Tier 1: Immediate ────────────────────────────────────────────────────

  /**
   * Agreement rate: |same_vote| / total_votes
   * @remarks Measures raw consensus among voters
   */
  agreementRate: number;

  // ─── Tier 2: Statistical ──────────────────────────────────────────────────

  /**
   * Entropy-based confidence: 1 - H(votes)/H_max
   * @remarks Low entropy = high agreement = high confidence
   */
  entropyConfidence: number;

  /**
   * Variance-based confidence: 1 - σ²/max_σ²
   * @remarks Low variance = consistent predictions = high confidence
   */
  varianceConfidence: number;

  // ─── Tier 3: Behavioral ───────────────────────────────────────────────────

  /**
   * Retry-based confidence: e^(-λ × retry_count)
   * @remarks More retries = less stable = lower confidence
   */
  retryConfidence: number;

  /**
   * Verification depth confidence
   * @remarks Tracks how many verification steps were performed
   */
  verificationDepth: number;

  // ─── Tier 4: Bayesian (Optional) ──────────────────────────────────────────

  /**
   * Bayesian posterior confidence (requires historical data)
   * @remarks P(correct | evidence) using prior knowledge
   */
  bayesianPosterior?: number;

  // ─── Composite ────────────────────────────────────────────────────────────

  /**
   * Final weighted composite confidence score (0-1)
   * @remarks This is the primary value to use for decisions
   */
  composite: number;

  /**
   * Audit metadata for the confidence calculation
   */
  metadata: ConfidenceMetadata;
}

// ─────────────────────────────────────────────────────────────────────────────
// CONFIDENCE METADATA
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Audit trail metadata for confidence calculations.
 *
 * @remarks
 * Every objective confidence value must be traceable to its inputs.
 * This metadata enables debugging, audit compliance, and trust verification.
 */
export interface ConfidenceMetadata {
  /** Timestamp of calculation */
  calculatedAt: number;

  /** Which tiers contributed to the composite score */
  contributingTiers: TierName[];

  /** Weights used for each tier */
  weights: ConfidenceWeights;

  /** Human-readable formula used for composite calculation */
  formula: string;

  /** Individual signals from each tier */
  signals: ConfidenceSignal[];

  /** Version of the confidence calculation algorithm */
  algorithmVersion: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// CONFIGURATION TYPES
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Weight configuration for composite confidence calculation.
 *
 * @remarks
 * Weights must sum to 1.0. Different domains may prioritize different tiers.
 * For example, high-stakes decisions might weight behavioral signals higher.
 */
export interface ConfidenceWeights {
  /** Weight for agreement rate (Tier 1) */
  agreementRate: number;

  /** Weight for entropy confidence (Tier 2a) */
  entropyConfidence: number;

  /** Weight for variance confidence (Tier 2b) */
  varianceConfidence: number;

  /** Weight for retry confidence (Tier 3) */
  retryConfidence: number;

  /** Weight for verification depth (Tier 3) */
  verificationDepth: number;

  /** Weight for Bayesian posterior (Tier 4, optional) */
  bayesianPosterior?: number;
}

/**
 * Domain-specific weight presets.
 *
 * @remarks
 * Different use cases may benefit from different tier weightings.
 */
export type ConfidencePreset =
  | "balanced" // Default balanced weights
  | "consensus" // Emphasizes agreement metrics
  | "stability" // Emphasizes behavioral signals
  | "precision" // Emphasizes statistical signals
  | "bayesian" // Requires historical data
  | "gantt" // Schedule generation - high agreement, medium entropy/variance
  | "highStakes"; // Critical decisions - maximum agreement + verification

// ─────────────────────────────────────────────────────────────────────────────
// INPUT TYPES
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Input data for objective confidence calculation.
 *
 * @remarks
 * Not all fields are required. The calculation adapts based on available data.
 * Missing data results in that tier being excluded from the composite.
 */
export interface ConfidenceInput {
  /** Votes from consensus operation (for agreement/entropy) */
  votes?: Vote[];

  /** Numeric predictions for variance calculation */
  predictions?: number[];

  /** Number of retry attempts */
  retryCount?: number;

  /** Number of verification steps performed */
  verificationSteps?: number;

  /** Historical success rate for Bayesian prior */
  historicalSuccessRate?: number;

  /** Historical sample count for Bayesian prior strength */
  historicalSampleCount?: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// THRESHOLD TYPES
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Decision thresholds for confidence-based routing.
 *
 * @remarks
 * These thresholds determine how confidence scores map to decisions.
 */
export interface ConfidenceThresholds {
  /** Below this = low confidence, requires human review */
  low: number;

  /** Above this = high confidence, safe to auto-approve */
  high: number;

  /** Minimum for any automated action */
  minimum: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// CALCULATION OPTIONS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Options for confidence calculation behavior.
 */
export interface ConfidenceCalculationOptions {
  /** Custom weights (overrides preset) */
  weights?: Partial<ConfidenceWeights>;

  /** Preset to use */
  preset?: ConfidencePreset;

  /** Maximum variance to normalize against */
  maxVariance?: number;

  /** Lambda for exponential retry decay */
  retryLambda?: number;

  /** Include Bayesian tier (requires historical data) */
  includeBayesian?: boolean;
}
