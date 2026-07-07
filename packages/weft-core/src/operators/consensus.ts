/**
 * @module weft-core/operators/consensus
 * @description Consensus operator: single-round weighted voting across multiple agent voters.
 * @blast_radius MEDIUM - Used by debate operator; consensus shape is part of public API
 * @status STABLE
 */

import type { AgentComputation, AgentUnitMetadata } from "../AgentUnit";
// Objective confidence calculation for consensus operations
import { calculateObjectiveConfidence } from "../confidence";
import type {
  AgentContext,
  ConsensusOptions,
  ConsensusResult,
  Vote,
  VoteInput,
} from "../types";

/**
 * Type for a voter function that can return various types.
 */
type Voter<T> = (
  proposal: T,
) =>
  | import("../AgentUnit").AgentUnit<Vote | VoteInput>
  | Promise<Vote | VoteInput>
  | Vote
  | VoteInput;

/**
 * Creates a computation that implements single-round consensus voting.
 *
 * @remarks
 * This is the free-tier single-round consensus. For multi-round TaCo consensus,
 * see weft-pro package.
 */
export function createConsensusComputation<T>(
  innerComputation: AgentComputation<T>,
  voters: Array<Voter<T>>,
  _innerMeta: AgentUnitMetadata,
  options: ConsensusOptions = {},
): AgentComputation<ConsensusResult> {
  const {
    quorum = 0.5,
    weights = {},
    vetoers = [],
    timeout: voteTimeout,
  } = options;

  return async (ctx: AgentContext): Promise<ConsensusResult> => {
    // Get the proposal
    const proposal = await innerComputation(ctx);

    // Collect all votes in parallel
    const votePromises = voters.map(async (voter, index) => {
      const agentId = `voter_${index}`;
      const weight = weights[agentId] ?? 1.0;

      try {
        let voteResult:
          | import("../AgentUnit").AgentUnit<Vote | VoteInput>
          | Promise<Vote | VoteInput>
          | Vote
          | VoteInput;

        if (voteTimeout) {
          // ⚠️ FIX-GUARD[FP-CONSENSUS-TIMER-LEAK-20260313]: Clear timeout
          // handle when vote resolves first to prevent timer leak.
          let timer: ReturnType<typeof setTimeout> | undefined;
          const timeoutPromise = new Promise<never>((_, reject) => {
            timer = setTimeout(() => {
              reject(new Error(`Vote timeout after ${voteTimeout}ms`));
            }, voteTimeout);
          });

          try {
            voteResult = await Promise.race([
              Promise.resolve(voter(proposal)),
              timeoutPromise,
            ]);
          } finally {
            if (timer !== undefined) clearTimeout(timer);
          }
        } else {
          voteResult = voter(proposal);
        }

        // Handle different return types
        let voteInput: VoteInput;
        if (
          typeof voteResult === "object" &&
          voteResult !== null &&
          "run" in voteResult
        ) {
          // AgentUnit-like object - use legacy mode for internal calls
          // Consensus handles confidence internally through votes, not TrackedResult
          const unit = voteResult as import("../AgentUnit").AgentUnit<
            Vote | VoteInput
          >;
          const result = await unit.run(ctx, { trustMode: "legacy" });
          voteInput =
            "agentId" in result
              ? {
                  decision: result.decision,
                  confidence: result.confidence,
                  reasoning: result.reasoning,
                }
              : result;
        } else if (voteResult instanceof Promise) {
          const result = await voteResult;
          voteInput =
            "agentId" in result
              ? {
                  decision: result.decision,
                  confidence: result.confidence,
                  reasoning: result.reasoning,
                }
              : result;
        } else {
          voteInput =
            "agentId" in voteResult
              ? {
                  decision: voteResult.decision,
                  confidence: voteResult.confidence,
                  reasoning: voteResult.reasoning,
                }
              : voteResult;
        }

        return { ...voteInput, agentId, weight };
      } catch (error) {
        // On timeout or error, abstain
        return {
          agentId,
          decision: "abstain" as const,
          confidence: 0,
          weight,
          reasoning: `Error: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    });

    const votes = await Promise.all(votePromises);

    // Validate vote confidences are finite numbers before proceeding
    // Prevents NaN propagation in objective confidence calculations
    for (const vote of votes) {
      if (!Number.isFinite(vote.confidence)) {
        vote.confidence = 0;
      }
    }

    // Calculate weighted approval
    const totalWeight = votes.reduce((sum, v) => sum + v.weight, 0);
    const approveWeight = votes
      .filter((v) => v.decision === "approve")
      .reduce((sum, v) => sum + v.weight, 0);

    const weightedApproval = totalWeight > 0 ? approveWeight / totalWeight : 0;

    // Calculate objective confidence from voting behavior
    // This replaces subjective LLM confidence with mathematically computed values
    const objectiveConfidence = calculateObjectiveConfidence({
      votes,
      retryCount: 0, // Consensus doesn't retry by default
    });

    // Check for veto
    const vetoVote = votes.find(
      (v) => vetoers.includes(v.agentId) && v.decision === "reject",
    );
    if (vetoVote) {
      return {
        approved: false,
        votes,
        weightedApproval,
        quorum,
        vetoedBy: vetoVote.agentId,
        consensus: "vetoed",
        objectiveConfidence,
      };
    }

    const approved = weightedApproval >= quorum;

    return {
      approved,
      votes,
      weightedApproval,
      quorum,
      consensus: approved ? "reached" : "not-reached",
      objectiveConfidence,
    };
  };
}
