/**
 * @module HarnessTypes - Core type contracts for weft-harness
 * @description Public interface definitions for HarnessConfig, PlanArtifact, VerifiedPlan,
 * and Harness. Wave 1 parallel implementations (adapters, permission bridge, session operator)
 * all implement against these types.
 * @rules @.cursor/rules/patterns/029-file-header-contracts.mdc
 */

import type { AgentUnit, TrackedResult } from "weft-core";

// ─── Adapter ─────────────────────────────────────────────────────────────────

export type HarnessAdapter = "claude-agent-sdk" | "openai-agents";

// ─── Progress Events ──────────────────────────────────────────────────────────

export type HarnessPhase =
  | "planning"
  | "verifying"
  | "executing"
  | "complete"
  | "failed";

export interface HarnessProgressEvent {
  phase: HarnessPhase;
  step?: PlanStep;
  tool?: string;
  votes?: ConsensusVote[];
  planId?: string;
  message?: string;
}

// ─── Configuration ────────────────────────────────────────────────────────────

export interface McpServerConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

export interface HarnessConfig {
  adapter: HarnessAdapter;
  tools?: string[];
  model?: string;
  mcpServers?: Record<string, McpServerConfig>;
  sessionPath?: string;
  onProgress?: (event: HarnessProgressEvent) => void;
}

// ─── Plan Artifact ────────────────────────────────────────────────────────────

export type ImpactTier = "P0" | "P1" | "P2" | "P3";

export interface SourceRef {
  readonly kind: "file" | "web" | "tool_output";
  readonly uri: string;
  readonly contentHash: string;
  readonly confidence: number;
}

export interface PlanStep {
  readonly index: number;
  readonly tool: string;
  readonly targetPath?: string;
  readonly reasoning: string;
  readonly dependsOn: readonly number[];
}

export interface PlanArtifact {
  readonly id: string;
  readonly intent: string;
  readonly steps: readonly PlanStep[];
  readonly requiredTools: readonly string[];
  readonly expectedOutputShape?: unknown;
  readonly estimatedImpact: ImpactTier;
  readonly sources: readonly SourceRef[];
}

// ─── Verified Plan ────────────────────────────────────────────────────────────

export interface ConsensusVote {
  voter: string;
  approved: boolean;
  confidence: number;
  reasoning: string;
}

export interface VerifiedPlan<T = unknown> {
  readonly plan: PlanArtifact;
  readonly votes: readonly ConsensusVote[];
  readonly approvalScore: number;
  readonly expectedOutput?: T;
}

// ─── Options ──────────────────────────────────────────────────────────────────

export interface PlanOptions {
  schema?: unknown;
  tools?: string[];
  maxSteps?: number;
  minSourceConfidence?: number;
}

/**
 * An AgentUnit produced by `harness.plan()` that additionally exposes a
 * `requireMinChainConfidence` gate. The gate creates a new AgentUnit that
 * re-throws a `LowProvenanceError` when the source-chain mean confidence is
 * below the given threshold, allowing callers to enforce a minimum evidence bar.
 */
export type PlanUnit = AgentUnit<TrackedResult<PlanArtifact>> & {
  requireMinChainConfidence(
    threshold: number,
  ): AgentUnit<TrackedResult<PlanArtifact>>;
};

export interface ExecuteOptions {
  rehearse?: boolean;
  rehearsalPath?: string;
  onDeviation?: "fail" | "rollback" | "ask";
  onProgress?: (event: HarnessProgressEvent) => void;
}

// ─── Harness Interface ────────────────────────────────────────────────────────

export interface Harness {
  plan(intent: string, options?: PlanOptions): PlanUnit;
  execute<T>(
    verified: VerifiedPlan<T>,
    options?: ExecuteOptions,
  ): AgentUnit<TrackedResult<T>>;
  session(prompt: string): AgentUnit<TrackedResult<string>>;
}
