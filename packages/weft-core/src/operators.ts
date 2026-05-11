/**
 * @fileoverview Basic operators for AgentUnit
 * @description Free-tier operators: retry, timeout, fallback, consensus, source tracking
 * @module @weft/core/operators
 * @since 1.0.0-beta.1
 *
 * 📝 BUILD[05.04]: Basic operators for @weft/core package (MIT License)
 */

import type { AgentComputation, AgentUnitMetadata } from "./AgentUnit";
import { calculateCompositeCoherence } from "./coherence/calculations/compositeCoherence";
import { resolveThreshold } from "./coherence/config";
// Coherence imports (STORY-02.02)
import type { EnsembleCoherence, HasVotes } from "./coherence/types";
import { hasContributions, hasVotes } from "./coherence/types";
// Objective confidence calculation for consensus operations
import { calculateObjectiveConfidence } from "./confidence";
import { SOLO_DEFAULTS } from "./solo/config";
import { shouldActSolo } from "./solo/decision";
import { acquireLock, releaseLock } from "./solo/lock";
import {
  commitTransaction,
  createTransaction,
  rollbackTransaction,
} from "./solo/transactionLog";
// Solo mechanism imports (STORY-02.01)
import type { ExtractedSignals, SoloConfig, SoloResult } from "./solo/types";
import { SoloBlockedError } from "./solo/types";
import type {
  // Dialectic types (F-048)
  AdvisorAgent,
  AgentContext,
  // Coherence types (STORY-02.01)
  CoherenceOptions,
  CoherenceResult,
  ConsensusOptions,
  ConsensusResult,
  ConvergeContribution,
  ConvergentAgent,
  ConvergeOptions,
  ConvergeResult,
  // Debate types (F-048)
  DebateAgent,
  DebateOptions,
  DebateResult,
  DialecticOptions,
  DialecticResult,
  LeaderAgent,
  RetryOptions,
  SourceTrackingOptions,
  TrackedResult,
  Vote,
  VoteInput,
} from "./types";
import { TRACKED_MARKER } from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

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

// ─────────────────────────────────────────────────────────────────────────────
// FALLBACK OPERATOR
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Creates a computation that falls back to another if the first fails.
 */
export function createFallbackComputation<T>(
  primaryComputation: AgentComputation<T>,
  fallbackComputation: AgentComputation<T>,
  _primaryMeta: AgentUnitMetadata,
  _fallbackMeta: AgentUnitMetadata,
): AgentComputation<T> {
  return async (ctx: AgentContext): Promise<T> => {
    try {
      return await primaryComputation(ctx);
    } catch (_error) {
      // Primary failed, try fallback
      return fallbackComputation(ctx);
    }
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// RETRY OPERATOR
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Creates a computation that retries on failure with exponential backoff.
 */
export function createRetryComputation<T>(
  innerComputation: AgentComputation<T>,
  _innerMeta: AgentUnitMetadata,
  options: RetryOptions & { maxAttempts: number },
): AgentComputation<T> {
  const {
    maxAttempts,
    baseDelayMs = 100,
    maxDelayMs = 5000,
    jitter = 0.1,
    retryIf,
  } = options;

  return async (ctx: AgentContext): Promise<T> => {
    let lastError: Error | unknown;
    const attempts = maxAttempts;

    for (let attempt = 1; attempt <= attempts; attempt++) {
      try {
        return await innerComputation(ctx);
      } catch (error) {
        lastError = error;

        // Check if we should retry
        if (retryIf && error instanceof Error) {
          if (!retryIf(error, attempt)) {
            throw error;
          }
        }

        // Don't retry on last attempt
        if (attempt === attempts) {
          throw error;
        }

        // Calculate delay with exponential backoff
        const baseDelay = Math.min(
          baseDelayMs * 2 ** (attempt - 1),
          maxDelayMs,
        );
        const jitterAmount = baseDelay * jitter * (Math.random() * 2 - 1);
        const delay = Math.max(0, baseDelay + jitterAmount);

        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }

    throw lastError;
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// TIMEOUT OPERATOR
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Creates a computation that times out after a specified duration.
 */
export function createTimeoutComputation<T>(
  innerComputation: AgentComputation<T>,
  _innerMeta: AgentUnitMetadata,
  options: { timeoutMs: number; message?: string },
): AgentComputation<T> {
  const { timeoutMs, message } = options;

  return async (ctx: AgentContext): Promise<T> => {
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => {
        reject(
          new Error(message ?? `Operation timed out after ${timeoutMs}ms`),
        );
      }, timeoutMs);
    });

    return Promise.race([innerComputation(ctx), timeoutPromise]);
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// SOURCE TRACKING OPERATOR
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Creates a computation that wraps results with source tracking metadata.
 */
export function createTrackedComputation<T>(
  innerComputation: AgentComputation<T>,
  _innerMeta: AgentUnitMetadata,
  options: SourceTrackingOptions,
): AgentComputation<TrackedResult<T>> {
  const { source, confidence, verifiedBy } = options;

  // Validate confidence
  if (typeof confidence !== "number" || !Number.isFinite(confidence)) {
    throw new Error(
      `tracked(): confidence must be a finite number, got ${confidence}`,
    );
  }
  if (confidence < 0 || confidence > 1) {
    throw new Error(
      `tracked(): confidence must be between 0 and 1, got ${confidence}`,
    );
  }

  return async (ctx: AgentContext): Promise<TrackedResult<T>> => {
    const value = await innerComputation(ctx);

    return {
      [TRACKED_MARKER]: true,
      value,
      source,
      confidence,
      verifiedBy: source === "verified" ? verifiedBy : undefined,
      verifiedAt: source === "verified" ? Date.now() : undefined,
      sourceChain: [source],
      minChainConfidence: confidence,
    };
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// CONSENSUS OPERATOR (Single-Round Only - Free Tier)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Type for a voter function that can return various types.
 */
type Voter<T> = (
  proposal: T,
) =>
  | import("./AgentUnit").AgentUnit<Vote | VoteInput>
  | Promise<Vote | VoteInput>
  | Vote
  | VoteInput;

/**
 * Creates a computation that implements single-round consensus voting.
 *
 * @remarks
 * This is the free-tier single-round consensus. For multi-round TaCo consensus,
 * see @weft/pro package.
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
          | import("./AgentUnit").AgentUnit<Vote | VoteInput>
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
          const unit = voteResult as import("./AgentUnit").AgentUnit<
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

// ─────────────────────────────────────────────────────────────────────────────
// CONVERGE OPERATOR (Iterative Boolean Convergence)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Creates a computation that implements iterative convergence.
 * Loops until all agents return hasMore: false or maxRounds hit.
 *
 * @remarks
 * Agents can return AgentUnit, Promise, or raw ConvergeContribution.
 * In parallel mode (default), all agents run simultaneously each round.
 * In sequential mode, each agent's result is immediately applied.
 *
 * @param initialValue - The starting state for convergence
 * @param agents - Array of convergent agent functions
 * @param options - Converge configuration options
 * @returns A computation that produces a ConvergeResult
 *
 * 📝 IMPL[fast-20260204]: Parallel vs Sequential mode - parallel runs all agents per round,
 *    sequential applies each result immediately (use for order-dependent refinement).
 * 📝 IMPL[fast-20260204]: State merging in parallel mode uses "last non-null wins" strategy
 *    because agents run simultaneously and can't see each other's changes mid-round.
 * ⚠️ CAUTION: trustMode: 'legacy' used in executeAgent() to avoid double-wrapping
 *    TrackedResult - converge handles confidence adjustment (+0.15) at the operator level.
 */
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

      // Execute a single agent and extract its contribution
      const executeAgent = async (
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
          // It's an AgentUnit - use legacy mode for internal calls
          const unit = result as import("./AgentUnit").AgentUnit<
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
        // Parallel mode: execute all agents simultaneously
        const results = await Promise.all(
          agents.map((agent, i) => executeAgent(agent, i)),
        );
        roundContributions.push(...results);
      } else {
        // Sequential mode: execute agents one by one, applying each result
        for (let i = 0; i < agents.length; i++) {
          const result = await executeAgent(agents[i], i);
          roundContributions.push(result);
          // Apply each contribution immediately in sequential mode
          currentState = result.contribution.result;
        }
      }

      // Track all contributions for audit trail
      for (const { agentId, contribution } of roundContributions) {
        allContributions.push({
          round,
          agentId,
          hadMore: contribution.hasMore,
          reasoning: contribution.reasoning,
        });
      }

      // Merge results in parallel mode (use last non-null result)
      if (parallel) {
        const lastResult = roundContributions
          .map((r) => r.contribution.result)
          .filter((r) => r !== null && r !== undefined)
          .pop();
        if (lastResult !== undefined) {
          currentState = lastResult;
        }
      }

      // Check convergence: all agents returned hasMore: false
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
// DEBATE OPERATOR (Story 01.03: F-048 Coordination Operators)
// ─────────────────────────────────────────────────────────────────────────────

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
              const unit = result as import("./AgentUnit").AgentUnit<
                ConvergeContribution<T>
              >;
              return unit.run(ctx, { trustMode: "legacy" });
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
      retryCount: maxConsensusAttempts - 1, // All retries used
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
// DIALECTIC OPERATOR (Story 01.04: F-048 Coordination Operators)
// ─────────────────────────────────────────────────────────────────────────────

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

// ─────────────────────────────────────────────────────────────────────────────
// COHERENCE OPERATOR
// 📝 BUILD[STORY-02.02]: Coherence computation factory
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// SOLO OPERATOR (Story 02.01-02.06: Weft-solo-mechanism)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Extract confidence, coherence, and risk signals from a value.
 *
 * @param value - The value to extract signals from
 * @returns Extracted signals with source information
 *
 * @remarks
 * Signal extraction priority:
 * 1. Explicit properties on the value (confidence, coherence, riskScore)
 * 2. TrackedResult metadata
 * 3. ConsensusResult/DebateResult/DialecticResult metadata
 * 4. Default values (conservative)
 *
 * 📝 BUILD[STORY-02.03]: Signal extraction for solo decision
 */
export function extractSignals(value: unknown): ExtractedSignals {
  // Default conservative signals
  let confidence = 0.5;
  let coherence = 0.5;
  let riskScore = 0.5;
  let source: ExtractedSignals["source"] = "default";

  if (value === null || value === undefined) {
    return { confidence, coherence, riskScore, source };
  }

  // Check if it's an object we can extract from
  if (typeof value !== "object") {
    return { confidence, coherence, riskScore, source };
  }

  const obj = value as Record<string, unknown>;

  // Check for explicit signals
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

  // Check for TrackedResult
  if (TRACKED_MARKER in obj) {
    const tracked = obj as unknown as TrackedResult<unknown>;
    if (source === "default") {
      confidence = tracked.confidence;
      source = "inferred";
    }
    // Extract objective confidence if available
    if (tracked.objectiveConfidence) {
      confidence = tracked.objectiveConfidence.composite;
      source = "inferred";
    }
  }

  // Check for multi-agent results with objectiveConfidence
  if (obj.objectiveConfidence && typeof obj.objectiveConfidence === "object") {
    const oc = obj.objectiveConfidence as { composite?: number };
    if (typeof oc.composite === "number") {
      confidence = oc.composite;
      source = "inferred";
    }
  }

  // Check for ConsensusResult
  if (typeof obj.weightedApproval === "number") {
    // Use weightedApproval as a coherence proxy
    if (source === "default" || coherence === 0.5) {
      coherence = obj.weightedApproval as number;
      source = "inferred";
    }
  }

  // Check for CoherenceResult
  if (obj.coherence && typeof obj.coherence === "object") {
    const coh = obj.coherence as { composite?: number };
    if (typeof coh.composite === "number") {
      coherence = coh.composite;
      source = "inferred";
    }
  }

  // Estimate risk based on value characteristics
  // Higher complexity = higher risk
  if (source === "default") {
    // Simple heuristic: larger objects = more complex = higher risk
    const keys = Object.keys(obj);
    riskScore = Math.min(0.5, keys.length * 0.05);
  }

  return { confidence, coherence, riskScore, source };
}

/**
 * Creates a computation that executes solo action with safety guarantees.
 *
 * @param innerComputation - The computation to execute if solo decision passes
 * @param innerMeta - Metadata from the upstream AgentUnit
 * @param config - Solo configuration options
 * @returns A computation that produces SoloResult<T>
 *
 * @remarks
 * Solo execution flow:
 * 1. Execute upstream computation to get value
 * 2. Extract confidence/coherence/risk signals
 * 3. Attempt lock acquisition
 * 4. Make solo decision
 * 5. If approved: create transaction, return result
 * 6. If blocked: release lock, throw SoloBlockedError
 *
 * 📝 BUILD[STORY-02.01]: Solo computation factory
 */
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
    // Step 1: Execute upstream computation
    const value = await innerComputation(ctx);

    // Step 2: Extract signals from value
    const signals = extractSignals(value);

    // Determine resource ID (from config, context, or default)
    const resourceId =
      configResourceId ??
      (ctx.extensions?.resourceId as string | undefined) ??
      `solo_${innerMeta.id}`;

    // Determine agent ID
    const agentId =
      (ctx.extensions?.agentId as string | undefined) ??
      `agent_${innerMeta.id}`;

    // Step 3: Attempt lock acquisition
    if (onLockAttempt) {
      await onLockAttempt(resourceId);
    }

    const lockResult = await acquireLock(resourceId, agentId, lockTimeout);
    const lockAcquired = lockResult.acquired;

    // Step 4: Make solo decision
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

    // Step 5/6: Handle decision
    if (!decision.canActSolo) {
      // Release lock if we acquired it
      if (lockAcquired) {
        const released = await releaseLock(resourceId, agentId);
        if (onLockRelease) {
          await onLockRelease(resourceId, released);
        }
      }

      // Invoke blocked callback
      if (onBlocked) {
        await onBlocked(decision);
      }

      // Throw error
      throw new SoloBlockedError(decision);
    }

    // Solo approved - create transaction
    const txn = createTransaction(agentId, "solo", {
      resourceId,
      signals,
      operatorChain: innerMeta.operatorChain,
    });

    try {
      // Invoke success callback
      if (onSoloAction) {
        await onSoloAction(decision);
      }

      // Commit transaction
      commitTransaction(txn.id, value);

      // Build result
      const result: SoloResult<T> = {
        value,
        decision,
        transactionId: txn.id,
        timestamp: Date.now(),
      };

      return result;
    } catch (error) {
      // Rollback transaction on error
      rollbackTransaction(
        txn.id,
        error instanceof Error ? error.message : String(error),
      );
      throw error;
    } finally {
      // Always release lock
      const released = await releaseLock(resourceId, agentId);
      if (onLockRelease) {
        await onLockRelease(resourceId, released);
      }
    }
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// COHERENCE ERROR
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Low coherence error with E304 code.
 *
 * @remarks
 * Thrown when `failOnLowCoherence: true` and coherence is below threshold.
 *
 * 📝 BUILD[STORY-02.04]: E304 error code for low coherence
 */
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

/**
 * Creates a computation that calculates coherence for a multi-agent result.
 *
 * @remarks
 * This factory follows the established pattern from other operators:
 * - Takes inner computation producing multi-agent result
 * - Returns computation producing CoherenceResult<T>
 * - Supports threshold checking and callbacks
 *
 * Type constraint: T must extend HasVotes (have a votes array).
 *
 * @param innerComputation - Upstream computation (consensus, debate, dialectic)
 * @param innerMeta - Metadata from upstream AgentUnit
 * @param options - Coherence options (threshold, preset, callbacks)
 * @returns Computation producing CoherenceResult<T>
 *
 * @example
 * ```typescript
 * // Used internally by AgentUnit.coherence()
 * const computation = createCoherenceComputation(
 *   consensusComputation,
 *   metadata,
 *   { threshold: 0.80 }
 * );
 * ```
 *
 * 📝 BUILD[STORY-02.02]: Coherence computation factory
 */
export function createCoherenceComputation<T extends HasVotes>(
  innerComputation: AgentComputation<T>,
  _innerMeta: AgentUnitMetadata,
  options: CoherenceOptions = {},
): AgentComputation<CoherenceResult<T>> {
  // Resolve threshold upfront
  const threshold = resolveThreshold(options);

  return async (ctx: AgentContext): Promise<CoherenceResult<T>> => {
    // Execute upstream computation
    const result = await innerComputation(ctx);

    // Type guard validation (should be guaranteed by TypeScript, but runtime safety)
    if (!hasVotes(result)) {
      throw new Error(
        "[E102] Context Error: .coherence() requires upstream result with votes array. " +
          "Chain after .consensus(), .debate(), or .dialectic().",
      );
    }

    // Extract inputs for coherence calculation
    const coherenceInput = {
      votes: result.votes,
      contributions: hasContributions(result)
        ? result.contributions
        : undefined,
    };

    // Calculate coherence
    const coherence = calculateCompositeCoherence(coherenceInput, {
      weights: options.weights,
    });

    // Check threshold
    const meetsThreshold = coherence.composite >= threshold;

    // Handle low coherence
    if (!meetsThreshold) {
      // Call callback if provided
      if (options.onDrop) {
        await options.onDrop(coherence);
      }

      // Throw if failOnLowCoherence
      if (options.failOnLowCoherence) {
        throw new CoherenceError(coherence, threshold);
      }
    }

    // Return result with coherence
    return {
      result,
      coherence,
      meetsThreshold,
      threshold,
    };
  };
}
