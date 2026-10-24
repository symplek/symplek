/**
 * @fileoverview Team types for @symplek/core
 * @description Type definitions for Team abstraction and TeamRegistry
 * @module @symplek/core/teams/types
 * @since 1.0.0-beta.1
 *
 * 📝 BUILD[F-048-01.07]: Team types for coordination teams
 */

import type {
  AdvisorAgent,
  ConvergentAgent,
  ConvergeOptions,
  ConvergeResult,
  DebateAgent,
  DebateOptions,
  DebateResult,
  DialecticOptions,
  DialecticResult,
  LeaderAgent,
} from "../types";

// ─────────────────────────────────────────────────────────────────────────────
// TEAM MODE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Available coordination modes for teams.
 *
 * @remarks
 * Each mode uses different coordination patterns:
 * - 'debate': Sequential converge + unanimous consensus
 * - 'dialectic': Leader-driven thesis/antithesis/synthesis
 * - 'converge': Iterative refinement until all done
 * - 'broadcast': Parallel execution, return all results
 *
 * 📝 BUILD[F-048-01.07]: Team mode union type
 */
export type TeamMode = "debate" | "dialectic" | "converge" | "broadcast";

// ─────────────────────────────────────────────────────────────────────────────
// TEAM CONFIGURATION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Configuration for creating a Team.
 *
 * @typeParam T - The type of input the team processes
 *
 * @remarks
 * TeamConfig is polymorphic based on mode:
 * - debate/converge modes require `agents`
 * - dialectic mode requires `leader` and `advisors`
 * - broadcast mode requires `agents`
 *
 * @example Debate team
 * ```typescript
 * const config: TeamConfig<Plan> = {
 *   name: 'qa-approval',
 *   mode: 'debate',
 *   agents: [unitTestAgent, e2eAgent, securityAgent],
 *   options: { maxConsensusAttempts: 2 }
 * };
 * ```
 *
 * @example Dialectic team
 * ```typescript
 * const config: TeamConfig<Problem> = {
 *   name: 'arch-council',
 *   mode: 'dialectic',
 *   leader: architectLeader,
 *   advisors: [securityAdvisor, perfAdvisor, costAdvisor],
 *   options: { terminationMode: 'leader-satisfied' }
 * };
 * ```
 *
 * 📝 BUILD[F-048-01.07]: Team configuration interface
 */
export interface TeamConfig<T> {
  /**
   * Unique name for this team.
   * Used as identifier in TeamRegistry.
   */
  name: string;

  /**
   * Optional description of the team's purpose.
   */
  description?: string;

  /**
   * Coordination mode for this team.
   */
  mode: TeamMode;

  /**
   * Agents for debate/converge/broadcast modes.
   * Required when mode is 'debate', 'converge', or 'broadcast'.
   */
  agents?: Array<ConvergentAgent<T> | DebateAgent<T>>;

  /**
   * Leader agent for dialectic mode.
   * Required when mode is 'dialectic'.
   */
  leader?: LeaderAgent<T>;

  /**
   * Advisor agents for dialectic mode.
   * Required when mode is 'dialectic'.
   */
  advisors?: Array<AdvisorAgent<T>>;

  /**
   * Mode-specific options.
   * Type depends on the mode:
   * - debate: DebateOptions
   * - dialectic: DialecticOptions
   * - converge: ConvergeOptions
   * - broadcast: (none)
   */
  options?: DebateOptions | DialecticOptions | ConvergeOptions;
}

// ─────────────────────────────────────────────────────────────────────────────
// TEAM RESULT
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Result from a Team invocation.
 *
 * @typeParam T - The type of the result value
 *
 * @remarks
 * TeamResult provides a unified interface across all modes.
 * Mode-specific details are available via optional fields.
 *
 * @example
 * ```typescript
 * const result = await teams.ask('qa-approval', plan).run(ctx);
 * console.log(result.team);          // 'qa-approval'
 * console.log(result.mode);          // 'debate'
 * console.log(result.outcome);       // 'consensus' | 'no-consensus' | ...
 * console.log(result.result);        // The final value
 * console.log(result.metadata);      // { rounds, durationMs, agentCount }
 * console.log(result.debate);        // Full DebateResult (if debate mode)
 * ```
 *
 * 📝 BUILD[F-048-01.07]: Unified team result interface
 */
export interface TeamResult<T> {
  /**
   * Name of the team that produced this result.
   */
  team: string;

  /**
   * Mode used for this invocation.
   */
  mode: TeamMode;

  /**
   * Outcome string (mode-specific).
   * For debate: 'consensus' | 'no-consensus' | 'exhausted'
   * For dialectic: 'satisfied' | 'consensus' | 'majority' | 'max-rounds'
   * For converge: 'converged' | 'max-rounds'
   * For broadcast: 'completed'
   */
  outcome: string;

  /**
   * Final result value.
   * Type depends on mode:
   * - debate: finalState from DebateResult
   * - dialectic: finalThesis from DialecticResult
   * - converge: finalResult from ConvergeResult
   * - broadcast: array of all agent results
   */
  result: T;

  /**
   * Execution metadata.
   */
  metadata: {
    /**
     * Number of rounds executed.
     * For broadcast mode, this is always 1.
     */
    rounds: number;

    /**
     * Total execution time in milliseconds.
     */
    durationMs: number;

    /**
     * Number of agents that participated.
     */
    agentCount: number;
  };

  /**
   * Full debate result (present if mode is 'debate').
   */
  debate?: DebateResult<T>;

  /**
   * Full dialectic result (present if mode is 'dialectic').
   */
  dialectic?: DialecticResult<T>;

  /**
   * Full converge result (present if mode is 'converge').
   */
  converge?: ConvergeResult<T>;
}
