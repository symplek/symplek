/**
 * @fileoverview Premium operator factories for @weft/pro
 * @description Debate, dialectic, coherence, and solo computation factories (commercial license)
 * @module @weft/pro/operators
 * @since 1.0.0-beta.1
 * @blast_radius MEDIUM
 * @status active
 */

import type {
  AgentComputation,
  AgentContext,
  AgentUnitMetadata,
  ConsensusOptions,
  ConsensusResult,
  TrackedResult,
  Vote,
  VoteInput,
} from "@weft/core";
import { TRACKED_MARKER } from "@weft/core";
import { calculateCompositeCoherence } from "./coherence/calculations/compositeCoherence";
import { resolveThreshold } from "./coherence/config";
import type { EnsembleCoherence, HasVotes } from "./coherence/types";
import { hasContributions, hasVotes } from "./coherence/types";
import { calculateObjectiveConfidence } from "./confidence";
import { SOLO_DEFAULTS } from "./solo/config";
import { shouldActSolo } from "./solo/decision";
import { acquireLock, releaseLock } from "./solo/lock";
import {
  commitTransaction,
  createTransaction,
  rollbackTransaction,
} from "./solo/transactionLog";
import type { ExtractedSignals, SoloConfig, SoloResult } from "./solo/types";
import { SoloBlockedError } from "./solo/types";
import type {
  CoherenceOptions,
  CoherenceResult,
  ConvergeContribution,
  ConvergentAgent,
  ConvergeOptions,
  ConvergeResult,
  DebateAgent,
  DebateOptions,
  DebateResult,
  DialecticOptions,
  DialecticResult,
  LeaderAgent,
} from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

const DEBATE_DEFAULT_CONFIDENCE = 0.8;
const DEBATE_VOTING_PHASE_ROUND = 0;

// ─────────────────────────────────────────────────────────────────────────────
// PRIVATE HELPERS (free-tier implementations used internally by premium ops)
// ─────────────────────────────────────────────────────────────────────────────

type Voter<T> = (
  proposal: T,
) =>
  | import("@weft/core").AgentUnit<Vote | VoteInput>
  | Promise<Vote | VoteInput>
  | Vote
  | VoteInput;

function createConsensusComputation<T>(
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
    const proposal = await innerComputation(ctx);

    const votePromises = voters.map(async (voter, index) => {
      const agentId = `voter_${index}`;
      const weight = weights[agentId] ?? 1.0;

      try {
        let voteResult:
          | import("@weft/core").AgentUnit<Vote | VoteInput>
          | Promise<Vote | VoteInput>
          | Vote
          | VoteInput;

        if (voteTimeout) {
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

        let voteInput: VoteInput;
        if (
          typeof voteResult === "object" &&
          voteResult !== null &&
          "run" in voteResult
        ) {
          const unit = voteResult as import("@weft/core").AgentUnit<
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

    const totalWeight = votes.reduce((sum, v) => sum + v.weight, 0);
    const approveWeight = votes
      .filter((v) => v.decision === "approve")
      .reduce((sum, v) => sum + v.weight, 0);

    const weightedApproval = totalWeight > 0 ? approveWeight / totalWeight : 0;

    const objectiveConfidence = calculateObjectiveConfidence({
      votes,
      retryCount: 0,
    });

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

export function createConvergeComputation<T>(
  initialValue: T,
  agents: Array<ConvergentAgent<T>>,
  options: ConvergeOptions = {},
): AgentComputation<ConvergeResult<T>> {
  const maxRounds = options.maxRounds ?? 5;
  const parallel = options.parallel ?? true;

  return async (ctx: AgentContext): Promise<ConvergeResult<T>> => {
    let currentState = initialValue;
    const allContributions: ConvergeResult<T>["contributions"] = [];
    let converged = false;

    for (let round = 1; round <= maxRounds; round++) {
      const roundContributions: Array<{
        agentId: string;
        contribution: ConvergeContribution<T>;
      }> = [];

      const executeAgentRound = async (
        agent: ConvergentAgent<T>,
        index: number,
      ): Promise<{
        agentId: string;
        contribution: ConvergeContribution<T>;
      }> => {
        const agentId = `agent-${index}`;
        const result = agent(currentState, round);

        let contribution: ConvergeContribution<T>;
        if (result && typeof (result as { run?: unknown }).run === "function") {
          const unit = result as import("@weft/core").AgentUnit<
            ConvergeContribution<T>
          >;
          contribution = await unit.run(ctx, { trustMode: "legacy" });
        } else if (result instanceof Promise) {
          contribution = await result;
        } else {
          contribution = result as ConvergeContribution<T>;
        }

        return { agentId, contribution };
      };

      if (parallel) {
        const results = await Promise.all(
          agents.map((agent, i) => executeAgentRound(agent, i)),
        );
        roundContributions.push(...results);
      } else {
        for (let i = 0; i < agents.length; i++) {
          const result = await executeAgentRound(agents[i], i);
          roundContributions.push(result);
          currentState = result.contribution.result;
        }
      }

      for (const { agentId, contribution } of roundContributions) {
        allContributions.push({
          round,
          agentId,
          hadMore: contribution.hasMore,
          reasoning: contribution.reasoning,
        });
      }

      if (parallel) {
        const lastResult = roundContributions
          .map((r) => r.contribution.result)
          .filter((r) => r !== null && r !== undefined)
          .pop();
        if (lastResult !== undefined) {
          currentState = lastResult;
        }
      }

      const allDone = roundContributions.every((r) => !r.contribution.hasMore);

      if (allDone) {
        converged = true;
        break;
      }
    }

    return {
      finalResult: currentState,
      rounds:
        allContributions.length > 0
          ? Math.max(...allContributions.map((c) => c.round))
          : 1,
      converged,
      contributions: allContributions,
    };
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// PREMIUM: DEBATE OPERATOR
// ─────────────────────────────────────────────────────────────────────────────

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

    for (let attempt = 1; attempt <= maxConsensusAttempts; attempt++) {
      const convergeResult = await createConvergeComputation(
        currentState,
        agents,
        { maxRounds, parallel: false },
      )(ctx);

      currentState = convergeResult.finalResult;
      totalRounds += convergeResult.rounds;
      allContributions = [...allContributions, ...convergeResult.contributions];

      if (onRoundComplete) {
        for (const contribution of convergeResult.contributions) {
          onRoundComplete(
            contribution.round,
            currentState,
            contribution.agentId,
          );
        }
      }

      const voters = agents.map((agent, index) => {
        return async (proposal: T): Promise<VoteInput> => {
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

          const contribution = await (async () => {
            const result = agent(proposal, DEBATE_VOTING_PHASE_ROUND);
            if (
              result &&
              typeof (result as { run?: unknown }).run === "function"
            ) {
              const unit = result as import("@weft/core").AgentUnit<
                ConvergeContribution<T>
              >;
              return unit.run(ctx, { trustMode: "legacy" });
            }
            if (result instanceof Promise) {
              return result;
            }
            return result as ConvergeContribution<T>;
          })();

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
        { quorum: 1.0 },
      )(ctx);

      lastVotes = consensusResult.votes;

      if (onConsensusAttempt) {
        onConsensusAttempt(attempt, consensusResult.votes);
      }

      if (consensusResult.approved) {
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

      objections = consensusResult.votes
        .filter((v) => v.decision === "reject")
        .map((v) => ({ agentId: v.agentId, reasoning: v.reasoning || "" }));

      if (onReject === "fail") {
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
    }

    const exhaustedObjectiveConfidence = calculateObjectiveConfidence({
      votes: lastVotes,
      retryCount: maxConsensusAttempts - 1,
    });

    return {
      outcome: "exhausted",
      finalState: currentState,
      rounds: totalRounds,
      attempts: maxConsensusAttempts,
      converged: false,
      votes: lastVotes,
      objections,
      contributions: allContributions,
      objectiveConfidence: exhaustedObjectiveConfidence,
    };
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// PREMIUM: DIALECTIC OPERATOR
// ─────────────────────────────────────────────────────────────────────────────

export function createDialecticComputation<T>(
  problem: T,
  leader: LeaderAgent<T>,
  advisors: Array<import("./types").AdvisorAgent<T>>,
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
      const thesisResponse = await leader.propose(currentProblem, round);
      const thesis = thesisResponse.thesis;

      if (onThesis) {
        onThesis(round, thesis);
      }

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

      const synthesisResponse = await leader.synthesize(thesis, critiques);
      const synthesis = synthesisResponse.synthesis;

      if (onSynthesis) {
        onSynthesis(synthesisResponse);
      }

      history.push({
        round,
        thesis,
        antitheses: critiques,
        synthesis,
      });

      currentProblem = synthesis;

      if (terminationMode === "leader-satisfied") {
        if (synthesisResponse.satisfied) {
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

// ─────────────────────────────────────────────────────────────────────────────
// PREMIUM: EXTRACT SIGNALS (for Solo)
// ─────────────────────────────────────────────────────────────────────────────

export function extractSignals(value: unknown): ExtractedSignals {
  let confidence = 0.5;
  let coherence = 0.5;
  let riskScore = 0.5;
  let source: ExtractedSignals["source"] = "default";

  if (value === null || value === undefined) {
    return { confidence, coherence, riskScore, source };
  }

  if (typeof value !== "object") {
    return { confidence, coherence, riskScore, source };
  }

  const obj = value as Record<string, unknown>;

  if (typeof obj.confidence === "number") {
    confidence = obj.confidence;
    source = "explicit";
  }
  if (typeof obj.coherence === "number") {
    coherence = obj.coherence;
    source = "explicit";
  }
  if (typeof obj.riskScore === "number") {
    riskScore = obj.riskScore;
    source = "explicit";
  }

  if (TRACKED_MARKER in obj) {
    const tracked = obj as unknown as TrackedResult<unknown>;
    if (source === "default") {
      confidence = tracked.confidence;
      source = "inferred";
    }
    if (tracked.objectiveConfidence) {
      confidence = tracked.objectiveConfidence.composite;
      source = "inferred";
    }
  }

  if (obj.objectiveConfidence && typeof obj.objectiveConfidence === "object") {
    const oc = obj.objectiveConfidence as { composite?: number };
    if (typeof oc.composite === "number") {
      confidence = oc.composite;
      source = "inferred";
    }
  }

  if (typeof obj.weightedApproval === "number") {
    if (source === "default" || coherence === 0.5) {
      coherence = obj.weightedApproval as number;
      source = "inferred";
    }
  }

  if (obj.coherence && typeof obj.coherence === "object") {
    const coh = obj.coherence as { composite?: number };
    if (typeof coh.composite === "number") {
      coherence = coh.composite;
      source = "inferred";
    }
  }

  if (source === "default") {
    const keys = Object.keys(obj);
    riskScore = Math.min(0.5, keys.length * 0.05);
  }

  return { confidence, coherence, riskScore, source };
}

// ─────────────────────────────────────────────────────────────────────────────
// PREMIUM: SOLO OPERATOR
// ─────────────────────────────────────────────────────────────────────────────

export function createSoloComputation<T>(
  innerComputation: AgentComputation<T>,
  innerMeta: AgentUnitMetadata,
  config: SoloConfig = {},
): AgentComputation<SoloResult<T>> {
  const {
    confidenceThreshold = SOLO_DEFAULTS.confidenceThreshold,
    coherenceThreshold = SOLO_DEFAULTS.coherenceThreshold,
    riskThreshold = SOLO_DEFAULTS.riskThreshold,
    lockTimeout = SOLO_DEFAULTS.lockTimeout,
    resourceId: configResourceId,
    onSoloAction,
    onBlocked,
    onLockAttempt,
    onLockRelease,
  } = config;

  return async (ctx: AgentContext): Promise<SoloResult<T>> => {
    const value = await innerComputation(ctx);
    const signals = extractSignals(value);

    const resourceId =
      configResourceId ??
      (ctx.extensions?.resourceId as string | undefined) ??
      `solo_${innerMeta.id}`;

    const agentId =
      (ctx.extensions?.agentId as string | undefined) ??
      `agent_${innerMeta.id}`;

    if (onLockAttempt) {
      await onLockAttempt(resourceId);
    }

    const lockResult = await acquireLock(resourceId, agentId, lockTimeout);
    const lockAcquired = lockResult.acquired;

    const decision = shouldActSolo(
      signals.confidence,
      signals.coherence,
      signals.riskScore,
      lockAcquired,
      {
        confidenceThreshold,
        coherenceThreshold,
        riskThreshold,
      },
    );

    if (!decision.canActSolo) {
      if (lockAcquired) {
        const released = await releaseLock(resourceId, agentId);
        if (onLockRelease) {
          await onLockRelease(resourceId, released);
        }
      }

      if (onBlocked) {
        await onBlocked(decision);
      }

      throw new SoloBlockedError(decision);
    }

    const txn = createTransaction(agentId, "solo", {
      resourceId,
      signals,
      operatorChain: innerMeta.operatorChain,
    });

    try {
      if (onSoloAction) {
        await onSoloAction(decision);
      }

      commitTransaction(txn.id, value);

      const result: SoloResult<T> = {
        value,
        decision,
        transactionId: txn.id,
        timestamp: Date.now(),
      };

      return result;
    } catch (error) {
      rollbackTransaction(
        txn.id,
        error instanceof Error ? error.message : String(error),
      );
      throw error;
    } finally {
      const released = await releaseLock(resourceId, agentId);
      if (onLockRelease) {
        await onLockRelease(resourceId, released);
      }
    }
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// PREMIUM: COHERENCE ERROR + COHERENCE OPERATOR
// ─────────────────────────────────────────────────────────────────────────────

export class CoherenceError extends Error {
  readonly code = "E304";
  readonly coherence: EnsembleCoherence;
  readonly threshold: number;

  constructor(coherence: EnsembleCoherence, threshold: number) {
    super(
      `[E304] Coordination Error: Ensemble coherence ${coherence.composite.toFixed(4)} ` +
        `below threshold ${threshold.toFixed(4)}`,
    );
    this.name = "CoherenceError";
    this.coherence = coherence;
    this.threshold = threshold;
  }
}

export function createCoherenceComputation<T extends HasVotes>(
  innerComputation: AgentComputation<T>,
  _innerMeta: AgentUnitMetadata,
  options: CoherenceOptions = {},
): AgentComputation<CoherenceResult<T>> {
  const threshold = resolveThreshold(options);

  return async (ctx: AgentContext): Promise<CoherenceResult<T>> => {
    const result = await innerComputation(ctx);

    if (!hasVotes(result)) {
      throw new Error(
        "[E102] Context Error: .coherence() requires upstream result with votes array. " +
          "Chain after .consensus(), .debate(), or .dialectic().",
      );
    }

    const coherenceInput = {
      votes: result.votes,
      contributions: hasContributions(result)
        ? result.contributions
        : undefined,
    };

    const coherence = calculateCompositeCoherence(coherenceInput, {
      weights: options.weights,
    });

    const meetsThreshold = coherence.composite >= threshold;

    if (!meetsThreshold) {
      if (options.onDrop) {
        await options.onDrop(coherence);
      }

      if (options.failOnLowCoherence) {
        throw new CoherenceError(coherence, threshold);
      }
    }

    return {
      result,
      coherence,
      meetsThreshold,
      threshold,
    };
  };
}
