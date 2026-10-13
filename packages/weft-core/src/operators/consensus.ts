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

    /**
     * Execute the full voter pipeline — including any AgentUnit.run() — and
     * return a resolved VoteInput.  Accepts an optional AbortSignal that is
     * threaded into the AgentContext so downstream streaming / LLM calls can
     * be cancelled when a vote timeout fires.
     *
     * H-F03 fix: the previous code only raced `voter(proposal)` (the *call*)
     * against the timeout, not the actual LLM execution.  For AgentUnit voters
     * `voter(proposal)` returns the AgentUnit synchronously, so the race
     * resolved immediately and `unit.run()` ran outside the timeout window.
     * Moving the entire execution inside `executeVoterFully` and racing *that*
     * against the timeout ensures the LLM call is actually bounded.
     */
    const executeVoterFully = async (
      v: Voter<T>,
      timeoutSignal?: AbortSignal,
    ): Promise<VoteInput> => {
      // Compose the per-voter timeout signal with any existing context signal so
      // that upstream cancellation propagates through the vote timeout window.
      // Replacing ctx.signal entirely (the previous behaviour) meant that if the
      // caller aborted ctx.signal while voteTimeout was still running, the voter
      // continued unaware of the upstream cancellation for the full timeout duration.
      let runCtx = ctx;
      if (timeoutSignal) {
        if (ctx.signal) {
          // Use platform-native signal composition (Node >= 20 / WHATWG).
          // AbortSignal.any() immediately aborts the returned signal when ANY
          // input is already aborted — correctly handling the pre-aborted case
          // that listener-based composition misses (adding a listener to an
          // already-aborted signal never fires a new abort event).
          runCtx = { ...ctx, signal: AbortSignal.any([ctx.signal, timeoutSignal]) };
        } else {
          runCtx = { ...ctx, signal: timeoutSignal };
        }
      }

      const voterCallResult = v(proposal);

      let voteInput: VoteInput;
      if (
        typeof voterCallResult === "object" &&
        voterCallResult !== null &&
        "run" in voterCallResult
      ) {
        // AgentUnit — execute with the cancellable context
        const unit = voterCallResult as import("../AgentUnit").AgentUnit<
          Vote | VoteInput
        >;
        const { value: result } = await unit.run(runCtx);
        voteInput =
          "agentId" in result
            ? {
                decision: result.decision,
                confidence: result.confidence,
                reasoning: result.reasoning,
              }
            : result;
      } else if (voterCallResult instanceof Promise) {
        // Promise voters cannot receive an AbortSignal directly; race the awaiting
        // against the timeout/upstream signal so we stop waiting when cancelled.
        // The underlying operation may continue running but the vote is abandoned,
        // preventing a timed-out promise from blocking or mutating consensus state.
        const signal = runCtx.signal;
        if (signal) {
          // Use a local AbortController so the abort listener on `signal` is
          // automatically removed via { signal: localController.signal } when
          // localController.abort() fires in the finally block.  Without this,
          // a voter that resolves before the signal aborts would leave the
          // listener attached for the signal's lifetime, causing listener
          // accumulation on long-lived shared signals.
          const localController = new AbortController();
          const abortPromise = new Promise<never>((_, reject) => {
            if (signal.aborted) {
              reject(new DOMException("Vote aborted", "AbortError"));
            } else {
              signal.addEventListener(
                "abort",
                () => reject(new DOMException("Vote aborted", "AbortError")),
                { once: true, signal: localController.signal },
              );
            }
          });
          let raceResult: Vote | VoteInput;
          try {
            raceResult = await Promise.race([voterCallResult, abortPromise]);
          } finally {
            // Abort the local controller to remove the listener from `signal`,
            // regardless of whether the race settled via voter or abort.
            localController.abort();
          }
          voteInput =
            "agentId" in raceResult
              ? {
                  decision: raceResult.decision,
                  confidence: raceResult.confidence,
                  reasoning: raceResult.reasoning,
                }
              : raceResult;
        } else {
          const result = await voterCallResult;
          voteInput =
            "agentId" in result
              ? {
                  decision: result.decision,
                  confidence: result.confidence,
                  reasoning: result.reasoning,
                }
              : result;
        }
      } else {
        voteInput =
          "agentId" in voterCallResult
            ? {
                decision: voterCallResult.decision,
                confidence: voterCallResult.confidence,
                reasoning: voterCallResult.reasoning,
              }
            : voterCallResult;
      }
      return voteInput;
    };

    // Collect all votes in parallel
    const votePromises = voters.map(async (voter, index) => {
      const agentId = `voter_${index}`;
      const weight = weights[agentId] ?? 1.0;

      try {
        let voteInput: VoteInput;

        if (voteTimeout) {
          // ⚠️ FIX-GUARD[FP-CONSENSUS-TIMER-LEAK-20260313]: Clear timeout
          // handle when vote resolves first to prevent timer leak.
          //
          // H-F03 fix: create an AbortController per voter so the LLM call
          // can be cancelled when the timeout fires, not just the race boundary.
          const controller = new AbortController();
          let timer: ReturnType<typeof setTimeout> | undefined;
          const timeoutPromise = new Promise<never>((_, reject) => {
            timer = setTimeout(() => {
              controller.abort();
              reject(new Error(`Vote timeout after ${voteTimeout}ms`));
            }, voteTimeout);
          });

          try {
            voteInput = await Promise.race([
              executeVoterFully(voter, controller.signal),
              timeoutPromise,
            ]);
          } finally {
            if (timer !== undefined) clearTimeout(timer);
            // Abort the controller when the race settles for any reason
            // (no-op if the timeout already fired it).
            controller.abort();
          }
        } else {
          voteInput = await executeVoterFully(voter);
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
