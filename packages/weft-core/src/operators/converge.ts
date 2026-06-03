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
