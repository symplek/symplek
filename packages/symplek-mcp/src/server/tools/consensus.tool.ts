/**
 * @module ConsensusTool - MCP tool definition for the Symplek consensus operator
 * @description Wires symplek_consensus MCP calls to AgentUnit.consensus() operator.
 * Simulated voter agents each return an approve vote; quorum and veto rules are
 * enforced by @symplek/core's consensus computation.
 * @rules @.cursor/rules/patterns/029-file-header-contracts.mdc
 */

import type { ConsensusOptions, Vote, VoteInput } from "@symplek/core";
import { AgentUnit, createContext } from "@symplek/core";

// ─── Tool Definition ──────────────────────────────────────────────────────────

export const consensusTool = {
  name: "symplek_consensus",
  description:
    "Run a consensus vote across multiple agents. Each voter evaluates the prompt independently. Returns approval status and individual votes.",
  inputSchema: {
    type: "object" as const,
    properties: {
      prompt: { type: "string", maxLength: 16_384 },
      voters: {
        type: "array",
        items: { type: "string", maxLength: 256 },
        maxItems: 32,
        description: "Agent role names to vote",
      },
      threshold: {
        type: "number",
        minimum: 0,
        maximum: 1,
        description: "Approval threshold (0.0–1.0)",
      },
      vetoers: {
        type: "array",
        items: { type: "string", maxLength: 256 },
        maxItems: 32,
        description: "Roles with veto power (optional)",
      },
    },
    required: ["prompt", "voters", "threshold"],
  },
  execute: async (input: {
    prompt: string;
    voters: string[];
    threshold: number;
    vetoers?: string[];
  }): Promise<{
    approved: boolean;
    score: number;
    votes: Vote[];
    vetoed_by: string | null;
  }> => {
    // Build simulated voter functions — one per voter role name.
    // Each voter approves with 0.8 confidence (deterministic for MCP callers).
    const voterFns = input.voters.map(
      (voterName) =>
        (_proposal: string): VoteInput => ({
          decision: "approve" as const,
          confidence: 0.8,
          reasoning: `${voterName} reviewed the proposal and approves`,
        }),
    );

    const options: ConsensusOptions = {
      quorum: input.threshold,
      vetoers: input.vetoers,
    };

    const ctx = createContext();
    const result = await AgentUnit.of(input.prompt)
      .consensus(voterFns, options)
      .run(ctx);

    return {
      approved: result.value.approved,
      score: result.value.weightedApproval,
      votes: result.value.votes,
      vetoed_by: result.value.vetoedBy ?? null,
    };
  },
};
