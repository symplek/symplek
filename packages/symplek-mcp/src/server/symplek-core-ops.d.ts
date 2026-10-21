/**
 * @module symplek-core-ops.d.ts - Local AgentUnit operator augmentation for @symplek/core
 * @description The @symplek/core dist uses `declare module "../AgentUnit"` augmentations
 * which are relative to the dist directory and don't resolve from external consumers.
 * This file re-declares the operators on the `@symplek/core` module namespace so TypeScript
 * can see them in @symplek/mcp source files.
 */

import type {
  ConsensusOptions,
  ConsensusResult,
  SourceTrackingOptions,
  TrackedResult,
  VoteInput,
} from "@symplek/core";

// Local copies of types not exported from @symplek/core public API:

/** ConvergentAgent contribution — mirrors @symplek/core internal type. */
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

/** DebateOptions — mirrors @symplek/core internal DebateOptions. */
export interface DebateOptions {
  maxRounds?: number;
  maxConsensusAttempts?: number;
  onReject?: "retry" | "fail";
}

/** DebateResult — mirrors @symplek/core internal DebateResult. */
export interface DebateResult<T> {
  outcome: "consensus" | "no-consensus" | "exhausted";
  finalState: T;
  rounds: number;
  attempts: number;
  converged: boolean;
  votes?: import("@symplek/core").Vote[];
  contributions: Array<{
    round: number;
    agentId: string;
    hadMore: boolean;
    reasoning?: string;
  }>;
}

declare module "@symplek/core" {
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
