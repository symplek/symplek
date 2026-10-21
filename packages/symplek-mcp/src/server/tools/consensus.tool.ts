/**
 * @module ConsensusTool - MCP tool definition for the Symplek consensus operator
 * @description Wires symplek_consensus MCP calls to AgentUnit.consensus() operator.
 * Simulated voter agents each return an approve vote; quorum and veto rules are
 * enforced by @symplek/core's consensus computation.
 * @rules @.cursor/rules/patterns/029-file-header-contracts.mdc
 */

import type { ConsensusOptions, Vote, VoteInput } from "@symplek/core";
import { AgentUnit, createContext } from "@symplek/core";

/** Carried in every result so a stub approval cannot be read as a decision. */
const SIMULATION_NOTICE =
  "No evaluation took place. Every voter is a fixed stub that approves, whatever the prompt says. Do not treat `approved` as a decision.";

// ─── Tool Definition ──────────────────────────────────────────────────────────

export const consensusTool = {
  name: "symplek_consensus",
  // N52-consensus: previous description claimed each voter evaluates the prompt
  // independently. Voters are deterministic stubs — each always approves at 0.8
  // regardless of prompt content. The description now discloses simulation so no
  // caller mistakes the approval for genuine multi-perspective evaluation.
  description:
    "Fixture: exercises the Symplek consensus operator wiring without making LLM calls. " +
    "Voters are deterministic stubs — each always approves the prompt with confidence 0.8. " +
    "Quorum and veto rules are enforced by @symplek/core. " +
    "Use for operator wiring tests, threshold validation, and result-shape verification. " +
    "For real independent agent votes use AgentUnit.consensus() with model-backed voters.",
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
    simulated: true;
    notice: string;
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
          reasoning: `stub vote for "${voterName}": always approve, nothing was evaluated`,
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
      // The result says so itself, because a calling agent may act on the
      // payload without re-reading the tool description.
      simulated: true,
      notice: SIMULATION_NOTICE,
      approved: result.value.approved,
      score: result.value.weightedApproval,
      votes: result.value.votes,
      vetoed_by: result.value.vetoedBy ?? null,
    };
  },
};
