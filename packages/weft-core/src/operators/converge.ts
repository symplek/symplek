/**
 * @module weft-core/operators/converge
 * @description Converge operator: iterative boolean convergence until all agents return hasMore: false.
 * @blast_radius MEDIUM - Used by debate operator
 * @status STABLE
 */

import type { AgentComputation } from "../AgentUnit";
import type {
  AgentContext,
  ConvergeContribution,
  ConvergentAgent,
  ConvergeOptions,
  ConvergeResult,
} from "../types";

function isMergeableObject(value: unknown): value is Record<string, unknown> {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function mergeContributionResult<T>(state: T, result: T): T {
  if (isMergeableObject(state) && isMergeableObject(result)) {
    return { ...state, ...result } as T;
  }

  return result;
}

/**
 * Creates a computation that implements iterative convergence.
 * Loops until all agents return hasMore: false or maxRounds hit.
 *
 * @remarks
 * Agents can return AgentUnit, Promise, or raw ConvergeContribution.
 * In parallel mode (default), all agents run simultaneously each round against
 * the same state snapshot, then their results are applied deterministically in
 * agent-array order. Plain object states are shallow-merged so independent
 * fields from multiple agents are retained; non-object states still use
 * last-result-wins semantics.
 * In sequential mode, each agent's result is immediately applied.
 *
 * @param initialValue - The starting state for convergence
 * @param agents - Array of convergent agent functions
 * @param options - Converge configuration options
 * @returns A computation that produces a ConvergeResult
 *
 * 📝 IMPL[fast-20260204]: Parallel vs Sequential mode - parallel runs all agents per round,
 *    sequential applies each result immediately (use for order-dependent refinement).
 * 📝 IMPL[fast-20260204]: State merging in parallel mode applies completed
 *    contributions in input order after every agent has finished, making the
 *    final state independent of promise resolution timing.
 * ⚠️ CAUTION: trustMode: 'legacy' used in executeAgent() to avoid double-wrapping
 *    TrackedResult - converge handles confidence adjustment (+0.15) at the operator level.
 */
export function createConvergeComputation<T>(
  initialValue: T,
  agents: Array<ConvergentAgent<T>>,
  options: ConvergeOptions = {},
): AgentComputation<ConvergeResult<T>> {
  const maxRounds = (options.maxRounds ?? 5) < 1 ? 1 : (options.maxRounds ?? 5);
  const parallel = options.parallel ?? true;
  const mergeStrategy = options.mergeStrategy;

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
          const unit = result as import("../AgentUnit").AgentUnit<
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

      // Merge results in parallel mode.
      // Promise.all preserves the agents' input order, so this fold is deterministic
      // even when agents resolve at different times.
      if (parallel) {
        if (mergeStrategy === "last") {
          // Take the last agent's non-null result as-is (no merging).
          for (let i = roundContributions.length - 1; i >= 0; i--) {
            const { contribution } = roundContributions[i];
            if (contribution.result !== null && contribution.result !== undefined) {
              currentState = contribution.result;
              break;
            }
          }
        } else if (mergeStrategy === "reduce") {
          // Left-to-right fold: each non-null result replaces the accumulator.
          for (const { contribution } of roundContributions) {
            if (contribution.result !== null && contribution.result !== undefined) {
              currentState = contribution.result;
            }
          }
        } else {
          // Default (mergeStrategy not set): shallow-merge for plain objects,
          // last-wins for all other types. Backward-compatible behavior.
          for (const { contribution } of roundContributions) {
            if (
              contribution.result !== null &&
              contribution.result !== undefined
            ) {
              currentState = mergeContributionResult(
                currentState,
                contribution.result,
              );
            }
          }
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
