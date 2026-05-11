/**
 * @module weft-core-ops.d.ts - Local AgentUnit operator augmentation for weft-core
 * @description The weft-core dist uses `declare module "../AgentUnit"` augmentations
 * which are relative to the dist directory and don't resolve from external consumers.
 * This file re-declares the operators on the `weft-core` module namespace so TypeScript
 * can see them in weft-mcp source files.
 */

import type {
  ConsensusOptions,
  ConsensusResult,
  SourceTrackingOptions,
  TrackedResult,
  VoteInput,
} from "weft-core";

// Local copies of types not exported from weft-core public API:

/** ConvergentAgent contribution — mirrors weft-core internal type. */
export interface ConvergeContribution<T> {
  result: T;
  hasMore: boolean;
  reasoning?: string;
}

/** DebateAgent — a convergent agent used in debate coordination. */
export type DebateAgent<T> = (
  current: T,
  round: number,
) => ConvergeContribution<T> | Promise<ConvergeContribution<T>>;

/** DebateOptions — mirrors weft-core internal DebateOptions. */
export interface DebateOptions {
  maxRounds?: number;
  maxConsensusAttempts?: number;
  onReject?: "retry" | "fail";
}

/** DebateResult — mirrors weft-core internal DebateResult. */
export interface DebateResult<T> {
  outcome: "consensus" | "no-consensus" | "exhausted";
  finalState: T;
  rounds: number;
  attempts: number;
  converged: boolean;
  votes?: import("weft-core").Vote[];
  contributions: Array<{
    round: number;
    agentId: string;
    hadMore: boolean;
    reasoning?: string;
  }>;
}

declare module "weft-core" {
  interface AgentUnit<T> {
    /** Run debate coordination: sequential converge + unanimous consensus. */
    debate(
      agents: Array<DebateAgent<T>>,
      options?: DebateOptions,
    ): AgentUnit<DebateResult<T>>;

    /** Run consensus voting with multiple voters (single-round). */
    consensus(
      voters: Array<
        (proposal: T) => AgentUnit<VoteInput> | Promise<VoteInput> | VoteInput
      >,
      options?: ConsensusOptions,
    ): AgentUnit<ConsensusResult>;

    /** Wrap the result in a TrackedResult with source metadata. */
    tracked(options: SourceTrackingOptions): AgentUnit<TrackedResult<T>>;
  }
}
