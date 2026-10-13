/**
 * @module weft-core/operators/debate
 * @description Debate operator: sequential converge + unanimous consensus with optional retry on rejection.
 * @blast_radius MEDIUM
 * @status STABLE
 */

import type { AgentComputation, AgentUnitMetadata } from "../AgentUnit";
// Objective confidence calculation
import { calculateObjectiveConfidence } from "../confidence";
import type {
  AgentContext,
  ConvergeContribution,
  ConvergeResult,
  DebateAgent,
  DebateOptions,
  DebateResult,
  Vote,
  VoteInput,
} from "../types";
import { createConsensusComputation } from "./consensus";
import { createConvergeComputation } from "./converge";

/**
 * Default confidence for debate vote synthesis when agents don't report their own.
 * ⚠️ FIX-GUARD[FP-DEBATE-HARDCODED-CONFIDENCE-20260313]: Was hardcoded inline
 * as 0.8 in two places. Extracted to named constant for visibility and
 * configurability in a future version.
 */
const DEBATE_DEFAULT_CONFIDENCE = 0.8;

/**
 * Named constant for the voting phase round indicator in debate.
 * ⚠️ FIX-GUARD[FP-DEBATE-MAGIC-ROUND-20260313]: Was hardcoded as 0 inline
 * with only a code comment explaining its meaning.
 */
const DEBATE_VOTING_PHASE_ROUND = 0;

/**
 * Creates a computation that implements debate coordination.
 *
 * @remarks
 * Debate combines sequential converge with unanimous consensus:
 * 1. Run converge (sequential mode) until all agents return hasMore: false
 * 2. Take unanimous vote from all agents
 * 3. If unanimous approval → consensus reached
 * 4. If any rejection:
 *    - onReject: 'fail' → return no-consensus immediately
 *    - onReject: 'retry' → feed objections back, re-converge
 * 5. Repeat until consensus or maxConsensusAttempts exhausted
 *
 * @param initialState - The starting state for debate
 * @param agents - Array of debate agents (same interface as convergent agents)
 * @param options - Debate configuration options
 * @returns A computation that produces a DebateResult
 *
 * 📝 BUILD[F-048-01.03]: Debate operator implementation
 * ⚠️ CAUTION: Uses sequential converge (parallel: false) to maintain order
 */
export function createDebateComputation<T>(
  initialState: T,
  agents: Array<DebateAgent<T>>,
  options: DebateOptions = {},
): AgentComputation<DebateResult<T>> {
  const {
    maxRounds = 10,
    maxConsensusAttempts = 3,
    onReject = "retry",
    onRoundComplete,
    onConsensusAttempt,
  } = options;

  const safeMaxAttempts = maxConsensusAttempts < 1 ? 1 : maxConsensusAttempts;

  return async (ctx: AgentContext): Promise<DebateResult<T>> => {
    if (agents.length === 0) {
      return {
        outcome: "consensus",
        finalState: initialState,
        rounds: 0,
        attempts: 0,
        converged: true,
        votes: [],
        contributions: [],
        objectiveConfidence: {
          agreementRate: 0,
          entropyConfidence: 1.0,
          varianceConfidence: 1.0,
          retryConfidence: 1.0,
          verificationDepth: 0,
          composite: 1.0,
          metadata: {
            calculatedAt: Date.now(),
            contributingTiers: [],
            weights: {
              agreementRate: 0,
              entropyConfidence: 0,
              varianceConfidence: 0,
              retryConfidence: 0,
              verificationDepth: 0,
            },
            formula:
              "vacuous consensus: composite = 1.0 (no agents, no dissent)",
            signals: [],
            algorithmVersion: "2.0.0",
          },
        },
      };
    }

    let currentState = initialState;
    let allContributions: ConvergeResult<T>["contributions"] = [];
    let totalRounds = 0;
    let objections: Array<{ agentId: string; reasoning: string }> = [];
    let lastVotes: Vote[] = [];

    for (let attempt = 1; attempt <= safeMaxAttempts; attempt++) {
      // Phase 1: Run sequential converge
      const convergeResult = await createConvergeComputation(
        currentState,
        agents,
        { maxRounds, parallel: false },
      )(ctx);

      currentState = convergeResult.finalResult;
      totalRounds += convergeResult.rounds;
      allContributions = [...allContributions, ...convergeResult.contributions];

      // Fire onRoundComplete callbacks for each contribution
      if (onRoundComplete) {
        for (const contribution of convergeResult.contributions) {
          onRoundComplete(
            contribution.round,
            currentState,
            contribution.agentId,
          );
        }
      }

      // Phase 2: Unanimous vote
      // For single agent that already converged, reuse the contribution instead of calling again
      const voters = agents.map((agent, index) => {
        return async (proposal: T): Promise<VoteInput> => {
          // Check if this is a single agent that already converged in this round
          // Reuse the contribution from converge phase to avoid calling agent twice
          if (agents.length === 1 && convergeResult.converged) {
            const lastContribution = convergeResult.contributions
              .filter((c) => c.agentId === `agent-${index}`)
              .pop();
            if (lastContribution && !lastContribution.hadMore) {
              return {
                decision: "approve",
                confidence: DEBATE_DEFAULT_CONFIDENCE,
                reasoning: lastContribution.reasoning || "",
              };
            }
          }

          // Agent provides a contribution as its "vote"
          const contribution = await (async () => {
            const result = agent(proposal, DEBATE_VOTING_PHASE_ROUND);
            if (
              result &&
              typeof (result as { run?: unknown }).run === "function"
            ) {
              const unit = result as import("../AgentUnit").AgentUnit<
                ConvergeContribution<T>
              >;
              return (await unit.run(ctx)).value;
            }
            if (result instanceof Promise) {
              return result;
            }
            return result as ConvergeContribution<T>;
          })();

          // If agent signals no more changes (hasMore: false), it approves
          // If agent still wants changes, it rejects with reasoning
          return {
            decision: contribution.hasMore ? "reject" : "approve",
            confidence: DEBATE_DEFAULT_CONFIDENCE,
            reasoning: contribution.reasoning || "",
          };
        };
      });

      const consensusResult = await createConsensusComputation(
        async () => currentState,
        voters,
        {} as AgentUnitMetadata,
        { quorum: 1.0 }, // Unanimous required
      )(ctx);

      lastVotes = consensusResult.votes;

      // Fire onConsensusAttempt callback
      if (onConsensusAttempt) {
        onConsensusAttempt(attempt, consensusResult.votes);
      }

      // Check result
      if (consensusResult.approved) {
        // Unanimous consensus reached
        return {
          outcome: "consensus",
          finalState: currentState,
          rounds: totalRounds,
          attempts: attempt,
          converged: convergeResult.converged,
          votes: consensusResult.votes,
          contributions: allContributions,
          objectiveConfidence: consensusResult.objectiveConfidence,
        };
      }

      // Consensus not reached - collect objections
      objections = consensusResult.votes
        .filter((v) => v.decision === "reject")
        .map((v) => ({ agentId: v.agentId, reasoning: v.reasoning || "" }));

      if (onReject === "fail") {
        // Return immediately with no-consensus
        return {
          outcome: "no-consensus",
          finalState: currentState,
          rounds: totalRounds,
          attempts: attempt,
          converged: convergeResult.converged,
          votes: consensusResult.votes,
          objections,
          contributions: allContributions,
          objectiveConfidence: consensusResult.objectiveConfidence,
        };
      }

      // ⚠️ FIX-GUARD[FP-DEBATE-OBJECTIONS-20260313]: Objections are NOT
      // re-injected into agent inputs on retry. The ConvergentAgent<T> type
      // signature only accepts (state: T, round: number), so there's no
      // channel to pass objection text. Agents see the updated currentState
      // from the previous converge but not the rejection reasoning.
      // TODO(v2): Add optional objections parameter to ConvergentAgent<T>.
    }

    // Max attempts exhausted - calculate objective confidence from last votes
    const exhaustedObjectiveConfidence = calculateObjectiveConfidence({
      votes: lastVotes,
      retryCount: safeMaxAttempts - 1, // All retries used
    });

    return {
      outcome: "exhausted",
      finalState: currentState,
      rounds: totalRounds,
      attempts: safeMaxAttempts,
      converged: false,
      votes: lastVotes,
      objections,
      contributions: allContributions,
      objectiveConfidence: exhaustedObjectiveConfidence,
    };
  };
}
