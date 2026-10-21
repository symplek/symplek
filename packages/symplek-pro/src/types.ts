/**
 * @fileoverview Pro package type definitions
 * @description Commercial license - Advanced feature types
 * @module @symplek/pro/types
 * @since 1.0.0-beta.1
 *
 * 📝 BUILD[05.05]: Pro package type definitions
 */

// ─────────────────────────────────────────────────────────────────────────────
// TACO CONSENSUS TYPES
// ─────────────────────────────────────────────────────────────────────────────

/**
 * TaCo (Trajectory-Adjusted Collective Operations) multi-round consensus options.
 *
 * 📝 BUILD[05.05]: Pro feature - Multi-round iterative consensus
 *
 * @remarks
 * Extends basic consensus with iterative voting rounds where agents can
 * revise votes after seeing peer rationales. Reduces error amplification
 * from 17.2× (single-round) to <2× (multi-round).
 */
export interface TaCoConsensusOptions {
  /** Maximum number of voting rounds (default: 1 = single-round) */
  maxRounds?: number;

  /** Show other agents' rationales between rounds (default: false) */
  showRationales?: boolean;

  /** Stop when agreement exceeds threshold (0-1, default: 0.8) */
  convergenceThreshold?: number;

  /** Callback fired after each round completes */
  onRoundComplete?: (round: number, votes: TaCoVote[]) => void;
}

/**
 * Vote with rationale for TaCo consensus.
 *
 * 📝 BUILD[05.05]: Pro feature - Rationale sharing between rounds
 */
export interface TaCoVote {
  agentId: string;
  decision: "approve" | "reject";
  rationale: string;
  confidence: number;
}

/**
 * Result from TaCo multi-round consensus.
 *
 * 📝 BUILD[05.05]: Pro feature - Multi-round consensus result
 */
export interface TaCoResult {
  approved: boolean;
  rounds: TaCoRound[];
  finalAgreementLevel: number;
  converged: boolean;
  vetoedBy?: string;
}

/**
 * Single round result in TaCo consensus.
 *
 * 📝 BUILD[05.05]: Pro feature - Round-by-round tracking
 */
export interface TaCoRound {
  round: number;
  votes: TaCoVote[];
  agreementLevel: number;
  converged: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// STIGMERGY CONFIDENCE TYPES
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Pheromone with confidence metadata that decays over time.
 *
 * 📝 BUILD[05.05]: Pro feature - Confidence-aware stigmergy
 *
 * @remarks
 * Extends basic pheromone functionality with temporal confidence decay.
 * Confidence degrades over time based on evaporation rate, enabling
 * first-mover advantage windows where early deposits maintain higher
 * confidence before decay.
 */
export interface ConfidentPheromone<T> {
  /** The pheromone value being deposited */
  value: T;

  /** Initial confidence score (0.0 - 1.0) */
  confidence: number;

  /** Source of the pheromone */
  source: "user" | "agent" | "tool" | "verified" | "synthesized";

  /** Timestamp when pheromone was deposited (milliseconds since epoch) */
  depositedAt: number;

  /** Evaporation rate per second (default: 0.01 = 1% per second) */
  evaporationRate: number;

  /**
   * Calculate current confidence after temporal decay.
   *
   * Formula: currentConfidence = initialConfidence * (1 - evaporationRate)^(age_in_seconds)
   *
   * @returns Current confidence (0.0 - 1.0) accounting for elapsed time
   */
  currentConfidence(): number;

  /**
   * Check if pheromone has expired below confidence threshold.
   *
   * @returns True if current confidence is below minimum threshold
   */
  isExpired(): boolean;
}

/**
 * Options for depositing a pheromone with confidence metadata.
 *
 * 📝 BUILD[05.05]: Pro feature - Confidence deposit configuration
 */
export interface ConfidenceDepositOptions {
  /** Initial confidence (0.0 - 1.0) */
  confidence: number;

  /** Source of the pheromone */
  source: "user" | "agent" | "tool" | "verified" | "synthesized";

  /** Evaporation rate per second (default: 0.01) */
  evaporationRate?: number;

  /** Minimum confidence threshold for expiration (default: 0.1) */
  minConfidence?: number;
}

/**
 * Options for sensing pheromones with confidence filtering.
 *
 * 📝 BUILD[05.05]: Pro feature - Confidence-based filtering
 */
export interface ConfidenceSenseOptions {
  /** Minimum confidence threshold (pheromones below this are filtered) */
  minConfidence?: number;

  /** Include expired pheromones in results (default: false) */
  includeExpired?: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// ANTIBODY TYPES
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Pattern matcher for antibody detection.
 *
 * 📝 BUILD[05.05]: Pro feature - Pattern-based detection
 */
export type PatternMatcher =
  | { type: "regex"; pattern: RegExp }
  | { type: "function"; fn: (value: unknown) => boolean }
  | { type: "substring"; substring: string }
  | { type: "schema"; schema: unknown };

/**
 * Known bad output pattern for antibody registry.
 *
 * 📝 BUILD[05.05]: Pro feature - Adaptive immune system
 */
export interface BadOutputPattern {
  /** Unique identifier for this pattern */
  id: string;

  /** Matcher that detects the pattern */
  matcher: PatternMatcher;

  /** Human-readable description */
  description: string;

  /** Severity level */
  severity: "critical" | "high" | "medium" | "low";

  /** When this pattern was learned (timestamp) */
  learnedAt: number;

  /** Optional metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Result from antibody scanning.
 *
 * 📝 BUILD[05.05]: Pro feature - Scan result with recommendations
 */
export interface AntibodyScanResult {
  /** Whether to reject, quarantine, or allow */
  recommendation: "reject" | "quarantine" | "allow";

  /** Matched patterns */
  matches: Array<{
    patternId: string;
    description: string;
    severity: string;
  }>;

  /** Confidence in the detection (0-1) */
  confidence: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// TRUST TYPES
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Trust level for trusted traveler lanes.
 *
 * 📝 BUILD[05.05]: Pro feature - Trust-based fast lanes
 */
export type TrustLevel = "full" | "partial" | "none";

/**
 * Trust grant for a source.
 *
 * 📝 BUILD[05.05]: Pro feature - Trust registry entry
 */
export interface TrustGrant {
  /** Source identifier */
  sourceId: string;

  /** Trust level */
  level: TrustLevel;

  /** When trust was granted (timestamp) */
  grantedAt: number;

  /** Optional expiration timestamp */
  expiresAt?: number;

  /** Reason for trust grant */
  reason?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// OBSERVABILITY TYPES — MOVED TO @symplek/core (Phase 0 of opencore release)
// ─────────────────────────────────────────────────────────────────────────────
// ObservabilityVerbosity, TraceEntry, TraceCollector, Span, and
// ObservabilityOptions are now defined in and exported from @symplek/core.

// ─────────────────────────────────────────────────────────────────────────────
// CONVERGE TYPES (needed by Debate, Teams — moved to @symplek/pro in Wave 3)
// ─────────────────────────────────────────────────────────────────────────────

import type { Vote } from "@symplek/core";
export type { Vote };

import type {
  CoherencePreset,
  CoherenceWeights,
  EnsembleCoherence,
} from "./coherence/types";
import type { ObjectiveConfidence } from "./confidence";

export interface ConvergeContribution<T> {
  result: T;
  hasMore: boolean;
  reasoning?: string;
}

export interface ConvergeOptions {
  maxRounds?: number;
  /** @default true */
  parallel?: boolean;
  /**
   * How to combine parallel agent contributions in each round.
   *
   * - `"last"` (default): the contribution from the last agent in the array is
   *   used as the next round's starting state. Deterministic by array position —
   *   the same agent always wins within a round given the same input.
   * - `"reduce"`: contributions are applied left-to-right via a fold; each
   *   agent's result (if non-null) replaces the accumulator in order. All agents
   *   still execute from the **original** round state, not from each other's
   *   output, so this is not equivalent to serial mode.
   *
   * @default "last"
   */
  mergeStrategy?: "last" | "reduce";
}

export interface ConvergeResult<T> {
  finalResult: T;
  rounds: number;
  converged: boolean;
  contributions: Array<{
    round: number;
    agentId: string;
    hadMore: boolean;
    reasoning?: string;
  }>;
}

export type ConvergentAgent<T> = (
  current: T,
  round: number,
) =>
  | import("@symplek/core").AgentUnit<ConvergeContribution<T>>
  | Promise<ConvergeContribution<T>>
  | ConvergeContribution<T>;

// ─────────────────────────────────────────────────────────────────────────────
// DEBATE TYPES
// ─────────────────────────────────────────────────────────────────────────────

export type DebateAgent<T> = ConvergentAgent<T>;

export interface DebateOptions {
  maxRounds?: number;
  maxConsensusAttempts?: number;
  onReject?: "retry" | "fail";
  onRoundComplete?: <T>(round: number, state: T, agentId: string) => void;
  onConsensusAttempt?: (attempt: number, votes: Vote[]) => void;
}

export interface DebateResult<T> {
  outcome: "consensus" | "no-consensus" | "exhausted";
  finalState: T;
  rounds: number;
  attempts: number;
  converged: boolean;
  votes?: Vote[];
  objections?: Array<{ agentId: string; reasoning: string }>;
  contributions: ConvergeResult<T>["contributions"];
  objectiveConfidence?: ObjectiveConfidence;
}

// ─────────────────────────────────────────────────────────────────────────────
// DIALECTIC TYPES
// ─────────────────────────────────────────────────────────────────────────────

export interface Critique {
  advisorId: string;
  critique: string;
  suggestions?: string[];
  severity: "blocking" | "major" | "minor" | "nitpick";
}

export interface ThesisResponse<T> {
  thesis: T;
  reasoning?: string;
}

export interface SynthesisResponse<T> {
  synthesis: T;
  satisfied: boolean;
  reasoning?: string;
}

export interface LeaderAgent<T> {
  propose: (
    problem: T,
    round: number,
  ) => ThesisResponse<T> | Promise<ThesisResponse<T>>;
  synthesize: (
    thesis: T,
    critiques: Critique[],
  ) => SynthesisResponse<T> | Promise<SynthesisResponse<T>>;
}

export type AdvisorAgent<T> = (
  thesis: T,
  round: number,
) => Critique | Promise<Critique>;

export interface DialecticOptions {
  maxRounds?: number;
  terminationMode?: "leader-satisfied" | "consensus" | "majority";
  quorum?: number;
  onThesis?: <T>(round: number, thesis: T) => void;
  onAntitheses?: (critiques: Critique[]) => void;
  onSynthesis?: <T>(synthesisResponse: SynthesisResponse<T>) => void;
  onAdvisorError?: "blocking" | "warning" | "skip";
}

export interface DialecticResult<T> {
  outcome:
    | "satisfied"
    | "consensus"
    | "majority"
    | "max-rounds"
    | "no-consensus";
  finalThesis: T;
  rounds: number;
  history: Array<{
    round: number;
    thesis: T;
    antitheses: Critique[];
    synthesis: T;
  }>;
  finalVotes?: Vote[];
  objectiveConfidence?: ObjectiveConfidence;
}

// ─────────────────────────────────────────────────────────────────────────────
// COHERENCE OPERATOR TYPES
// ─────────────────────────────────────────────────────────────────────────────

export interface CoherenceOptions {
  threshold?: number;
  preset?: CoherencePreset;
  weights?: Partial<CoherenceWeights>;
  onDrop?: (coherence: EnsembleCoherence) => void | Promise<void>;
  failOnLowCoherence?: boolean;
}

export interface CoherenceResult<T> {
  result: T;
  coherence: EnsembleCoherence;
  meetsThreshold: boolean;
  threshold: number;
}
