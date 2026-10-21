/**
 * @fileoverview TaCo Iterative Consensus
 * @description Multi-round voting: agents see each other's rationale and revote
 * @module @symplek/pro/taco
 * @since 1.0.0-beta.1
 *
 * 📝 BUILD[05.05]: TaCo iterative consensus implementation
 *
 * @remarks
 * TaCo (Trajectory-Adjusted Collective Operations) implements iterative
 * consensus voting. Agents vote, see each other's rationales, revise, and
 * stop when agreement reaches the convergence threshold or the round limit.
 * No error-rate comparison against single-round voting has been measured.
 *
 * Requires @symplek/core as peer dependency.
 */

// License gate — FATAL #6 HARDENING (2026-07-07)
import "./license-gate";

import { AgentUnit } from "@symplek/core";
import type {
  TaCoConsensusOptions,
  TaCoResult,
  TaCoRound,
  TaCoVote,
} from "./types";

/**
 * Extends AgentUnit with TaCo multi-round consensus.
 *
 * 📝 BUILD[05.05]: Pro feature - Multi-round iterative consensus
 *
 * @example
 * ```typescript
 * import { AgentUnit } from '@symplek/core';
 * import { tacoConsensus } from '@symplek/pro';
 *
 * const proposal = AgentUnit.from(async () => "Adopt an async job queue");
 * const result = await tacoConsensus([voter1, voter2, voter3], {
 *   maxRounds: 3,
 *   showRationales: true,
 *   convergenceThreshold: 0.8,
 * })(proposal).run(ctx);
 * ```
 */
export function tacoConsensus<T>(
  voters: Array<(proposal: T, context?: string) => Promise<TaCoVote>>,
  options: TaCoConsensusOptions = {},
): (unit: AgentUnit<T>) => AgentUnit<TaCoResult> {
  const {
    maxRounds = 3,
    showRationales = true,
    convergenceThreshold = 0.8,
    onRoundComplete,
  } = options;

  return (unit: AgentUnit<T>) => {
    // ⚠️ FIX-GUARD[FP-SYMPLEK-PRO-DTS-20260302]: Fixed flatMap callback arity and return type for TaCoResult
    return unit.flatMap((proposal: T) =>
      AgentUnit.fromPromise(
        (async () => {
          const allRounds: TaCoRound[] = [];
          let previousRationales: string[] = [];
          let vetoedBy: string | undefined;

          // Multi-round voting loop
          for (let round = 1; round <= maxRounds; round++) {
            // Format rationales for context (empty for round 1)
            const rationaleContext =
              showRationales && previousRationales.length > 0
                ? formatRationalesForContext(previousRationales)
                : undefined;

            // Collect votes with rationales
            const votes = await Promise.all(
              voters.map((voter) => voter(proposal, rationaleContext)),
            );

            // Check for veto
            const vetoVote = votes.find(
              (v) => v.decision === "reject" && v.confidence === 1.0,
            );
            if (vetoVote) {
              vetoedBy = vetoVote.agentId;
            }

            // Calculate agreement level
            const agreementLevel = calculateAgreement(votes);

            // Check convergence
            const converged = agreementLevel >= convergenceThreshold;

            const roundResult: TaCoRound = {
              round,
              votes,
              agreementLevel,
              converged,
            };

            allRounds.push(roundResult);

            // Fire callback
            onRoundComplete?.(round, votes);

            // Early exit on convergence (and no veto)
            if (converged && !vetoedBy) {
              return buildTaCoResult(
                votes,
                allRounds,
                agreementLevel,
                true,
                vetoedBy,
              );
            }

            // Prepare rationales for next round
            previousRationales = votes.map((v) => v.rationale);
          }

          // No convergence - fallback to best round
          const bestRound = findBestRound(allRounds);
          return buildTaCoResult(
            bestRound.votes,
            allRounds,
            bestRound.agreementLevel,
            false,
            vetoedBy,
          );
        })(),
      ),
    );
  };
}

/**
 * Format rationales for context sharing.
 *
 * 📝 BUILD[05.05]: Helper for rationale sharing
 */
function formatRationalesForContext(rationales: string[]): string {
  return rationales.map((r, i) => `Agent ${i + 1}: ${r}`).join("\n\n");
}

/**
 * Calculate agreement level from votes.
 *
 * Measures decision homogeneity: the fraction of voters that chose the
 * majority outcome. Unanimous approval AND unanimous rejection both score
 * 1.0, so either direction converges against the threshold without burning
 * every remaining round.
 *
 * 📝 BUILD[05.05]: Agreement calculation
 * Fix[N55]: was approval rate — unanimous rejection scored 0, never converged.
 */
function calculateAgreement(votes: TaCoVote[]): number {
  if (votes.length === 0) return 0;

  const approveCount = votes.filter((v) => v.decision === "approve").length;
  const rejectCount = votes.length - approveCount;
  // Homogeneity: fraction on the winning side.
  // unanimous approve → 1.0; unanimous reject → 1.0; 50/50 split → 0.5.
  return Math.max(approveCount, rejectCount) / votes.length;
}

/**
 * Find the best round (highest agreement).
 *
 * 📝 BUILD[05.05]: Best round selection
 */
function findBestRound(rounds: TaCoRound[]): TaCoRound {
  return rounds.reduce((best, current) =>
    current.agreementLevel > best.agreementLevel ? current : best,
  );
}

/**
 * Build TaCo result from votes and rounds.
 *
 * 📝 BUILD[05.05]: Result construction
 */
function buildTaCoResult(
  votes: TaCoVote[],
  rounds: TaCoRound[],
  agreementLevel: number,
  converged: boolean,
  vetoedBy?: string,
): TaCoResult {
  const approveCount = votes.filter((v) => v.decision === "approve").length;
  const approved = approveCount > votes.length / 2 && !vetoedBy;

  return {
    approved,
    rounds,
    finalAgreementLevel: agreementLevel,
    converged,
    vetoedBy,
  };
}
