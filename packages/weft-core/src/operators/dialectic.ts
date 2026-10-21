/**
 * @module @symplek/core/operators/dialectic
 * @description Dialectic operator: thesis/antithesis/synthesis pattern with leader and advisors.
 * @blast_radius MEDIUM
 * @status STABLE
 */

import type { AgentComputation } from "../AgentUnit";
// Objective confidence calculation
import { calculateObjectiveConfidence } from "../confidence";
import type {
  AdvisorAgent,
  AgentContext,
  DialecticOptions,
  DialecticResult,
  LeaderAgent,
  Vote,
} from "../types";

/**
 * Creates a computation that implements dialectic coordination.
 *
 * @remarks
 * Dialectic implements the thesis/antithesis/synthesis pattern:
 * 1. For each round:
 *    a. THESIS: Leader proposes solution
 *    b. ANTITHESIS: Advisors critique in parallel
 *    c. SYNTHESIS: Leader incorporates feedback
 * 2. Continue until termination condition:
 *    - 'leader-satisfied': Leader signals done via satisfied flag
 *    - 'consensus': All advisors have no blocking critiques
 *    - 'majority': Majority of advisors have no blocking critiques
 *
 * @param problem - The initial problem/state to solve
 * @param leader - The leader agent who drives synthesis
 * @param advisors - Array of advisor agents who critique
 * @param options - Dialectic configuration options
 * @returns A computation that produces a DialecticResult
 *
 * 📝 BUILD[F-048-01.04]: Dialectic operator implementation
 * ⚠️ CAUTION: Advisors run in parallel via Promise.all, not sequentially
 */
export function createDialecticComputation<T>(
  problem: T,
  leader: LeaderAgent<T>,
  advisors: Array<AdvisorAgent<T>>,
  options: DialecticOptions = {},
): AgentComputation<DialecticResult<T>> {
  const {
    maxRounds = 5,
    terminationMode = "leader-satisfied",
    quorum = terminationMode === "consensus" ? 1.0 : 0.5,
    onThesis,
    onAntitheses,
    onSynthesis,
    onAdvisorError = "blocking",
  } = options;

  return async (_ctx: AgentContext): Promise<DialecticResult<T>> => {
    let currentProblem = problem;
    const history: DialecticResult<T>["history"] = [];
    let finalVotes: Vote[] | undefined;

    for (let round = 1; round <= maxRounds; round++) {
      // THESIS: Leader proposes
      const thesisResponse = await leader.propose(currentProblem, round);
      const thesis = thesisResponse.thesis;

      if (onThesis) {
        onThesis(round, thesis);
      }

      // ANTITHESIS: Advisors critique in parallel
      const rawCritiques = await Promise.all(
        advisors.map(async (advisor, index) => {
          try {
            const critique = await advisor(thesis, round);
            return {
              ...critique,
              advisorId: critique.advisorId || `advisor-${index}`,
            };
          } catch (error) {
            if (onAdvisorError === "skip") {
              return null;
            }
            const severity =
              onAdvisorError === "warning"
                ? ("minor" as const)
                : ("blocking" as const);
            return {
              advisorId: `advisor-${index}`,
              critique: `Error during critique: ${error instanceof Error ? error.message : String(error)}`,
              severity,
            };
          }
        }),
      );
      const critiques = rawCritiques.filter(
        (c): c is NonNullable<typeof c> => c !== null,
      );

      if (onAntitheses) {
        onAntitheses(critiques);
      }

      // SYNTHESIS: Leader incorporates feedback
      const synthesisResponse = await leader.synthesize(thesis, critiques);
      const synthesis = synthesisResponse.synthesis;

      if (onSynthesis) {
        onSynthesis(synthesisResponse);
      }

      // Record history
      history.push({
        round,
        thesis,
        antitheses: critiques,
        synthesis,
      });

      // Update problem state for next round
      currentProblem = synthesis;

      // Check termination conditions
      if (terminationMode === "leader-satisfied") {
        if (synthesisResponse.satisfied) {
          // ⚠️ FIX-GUARD[FP-DIALECTIC-LEADER-CONFIDENCE-20260313]: Was calling
          // calculateObjectiveConfidence({ votes: [] }) which returns composite 0
          // because no signals are produced from empty votes. Leader satisfaction
          // is an explicit high-confidence signal — construct the result directly.
          return {
            outcome: "satisfied",
            finalThesis: synthesis,
            rounds: round,
            history,
            objectiveConfidence: {
              agreementRate: 1.0,
              entropyConfidence: 1.0,
              varianceConfidence: 1.0,
              retryConfidence: Math.exp(-0.5 * (round - 1)),
              verificationDepth: round,
              composite: 0.95,
              metadata: {
                calculatedAt: Date.now(),
                contributingTiers: ["behavioral"],
                weights: {
                  agreementRate: 0,
                  entropyConfidence: 0,
                  varianceConfidence: 0,
                  retryConfidence: 0.1,
                  verificationDepth: 0.1,
                },
                formula:
                  "leader-satisfied: composite = 0.95 (explicit satisfaction signal)",
                signals: [],
                algorithmVersion: "2.0.0",
              },
            },
          };
        }
      } else {
        // consensus or majority mode - check advisor approval
        // Convert critiques to votes: no blocking/major = approve
        const votes: Vote[] = critiques.map((c, i) => {
          const approves = c.severity !== "blocking" && c.severity !== "major";
          return {
            agentId: c.advisorId || `advisor-${i}`,
            decision: approves ? "approve" : "reject",
            confidence: approves ? 0.8 : 0.5,
            reasoning: c.critique,
            weight: 1.0,
          };
        });

        finalVotes = votes;

        const approveCount = votes.filter(
          (v) => v.decision === "approve",
        ).length;
        const approvalRate = votes.length > 0 ? approveCount / votes.length : 0;

        if (terminationMode === "consensus" && approvalRate >= 1.0) {
          return {
            outcome: "consensus",
            finalThesis: synthesis,
            rounds: round,
            history,
            finalVotes: votes,
            objectiveConfidence: calculateObjectiveConfidence({ votes }),
          };
        }

        if (terminationMode === "majority" && approvalRate >= quorum) {
          return {
            outcome: "majority",
            finalThesis: synthesis,
            rounds: round,
            history,
            finalVotes: votes,
            objectiveConfidence: calculateObjectiveConfidence({ votes }),
          };
        }

        // If leader is satisfied but voting required, check voting
        if (synthesisResponse.satisfied) {
          if (terminationMode === "consensus" && approvalRate < 1.0) {
            return {
              outcome: "no-consensus",
              finalThesis: synthesis,
              rounds: round,
              history,
              finalVotes: votes,
              objectiveConfidence: calculateObjectiveConfidence({ votes }),
            };
          }
          if (terminationMode === "majority" && approvalRate < quorum) {
            return {
              outcome: "no-consensus",
              finalThesis: synthesis,
              rounds: round,
              history,
              finalVotes: votes,
              objectiveConfidence: calculateObjectiveConfidence({ votes }),
            };
          }
        }
      }
    }

    // Max rounds reached
    return {
      outcome: "max-rounds",
      finalThesis: currentProblem,
      rounds: maxRounds,
      history,
      finalVotes,
      objectiveConfidence: finalVotes
        ? calculateObjectiveConfidence({
            votes: finalVotes,
            retryCount: maxRounds,
          })
        : calculateObjectiveConfidence({ votes: [], retryCount: maxRounds }),
    };
  };
}
