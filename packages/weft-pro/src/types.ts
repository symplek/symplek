/**
 * @fileoverview Pro package type definitions
 * @description Commercial license — pro-specific types. Operator/convergence types re-exported from weft-core.
 * @module weft-pro/types
 * @since 1.0.0-beta.1
 */

// ─────────────────────────────────────────────────────────────────────────────
// TACO CONSENSUS TYPES
// ─────────────────────────────────────────────────────────────────────────────

/**
 * TaCo (Trajectory-Adjusted Collective Operations) multi-round consensus options.
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

/** Vote with rationale for TaCo consensus. */
export interface TaCoVote {
  agentId: string;
  decision: "approve" | "reject";
  rationale: string;
  confidence: number;
}

/** Result from TaCo multi-round consensus. */
export interface TaCoResult {
  approved: boolean;
  rounds: TaCoRound[];
  finalAgreementLevel: number;
  converged: boolean;
  vetoedBy?: string;
}

/** Single round result in TaCo consensus. */
export interface TaCoRound {
  round: number;
  votes: TaCoVote[];
  agreementLevel: number;
  converged: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// STIGMERGY CONFIDENCE TYPES
// ─────────────────────────────────────────────────────────────────────────────

/** Pheromone with confidence metadata that decays over time. */
export interface ConfidentPheromone<T> {
  value: T;
  confidence: number;
  source: "user" | "agent" | "tool" | "verified" | "synthesized";
  depositedAt: number;
  evaporationRate: number;
  currentConfidence(): number;
  isExpired(): boolean;
}

/** Options for depositing a pheromone with confidence metadata. */
export interface ConfidenceDepositOptions {
  confidence: number;
  source: "user" | "agent" | "tool" | "verified" | "synthesized";
  evaporationRate?: number;
  minConfidence?: number;
}

/** Options for sensing pheromones with confidence filtering. */
export interface ConfidenceSenseOptions {
  minConfidence?: number;
  includeExpired?: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// ANTIBODY TYPES
// ─────────────────────────────────────────────────────────────────────────────

/** Pattern matcher for antibody detection. */
export type PatternMatcher =
  | { type: "regex"; pattern: RegExp }
  | { type: "function"; fn: (value: unknown) => boolean }
  | { type: "substring"; substring: string }
  | { type: "schema"; schema: unknown };

/** Known bad output pattern for antibody registry. */
export interface BadOutputPattern {
  id: string;
  matcher: PatternMatcher;
  description: string;
  severity: "critical" | "high" | "medium" | "low";
  learnedAt: number;
  metadata?: Record<string, unknown>;
}

/** Result from antibody scanning. */
export interface AntibodyScanResult {
  recommendation: "reject" | "quarantine" | "allow";
  matches: Array<{
    patternId: string;
    description: string;
    severity: string;
  }>;
  confidence: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// TRUST TYPES
// ─────────────────────────────────────────────────────────────────────────────

/** Trust level for trusted traveler lanes. */
export type TrustLevel = "full" | "partial" | "none";

/** Trust grant for a source. */
export interface TrustGrant {
  sourceId: string;
  level: TrustLevel;
  grantedAt: number;
  expiresAt?: number;
  reason?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// RE-EXPORTS — Pro operator types sourced from core subpaths
// ─────────────────────────────────────────────────────────────────────────────

export type { Vote } from "weft-core";
export type {
  AdvisorAgent,
  CoherenceOptions,
  CoherenceResult,
  ConvergeContribution,
  ConvergentAgent,
  ConvergeOptions,
  ConvergeResult,
  Critique,
  DebateAgent,
  DebateOptions,
  DebateResult,
  DialecticOptions,
  DialecticResult,
  LeaderAgent,
  SynthesisResponse,
  ThesisResponse,
} from "weft-core/operators";
