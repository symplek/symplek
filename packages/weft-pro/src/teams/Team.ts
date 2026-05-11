/**
 * @fileoverview Team - Reusable agent team definitions
 * @description Define teams once, invoke from anywhere with consistent coordination
 * @module weft-core/teams/Team
 * @since 1.0.0-beta.1
 *
 * 📝 BUILD[F-048-01.08]: Team class implementation
 */

import { AgentUnit } from "weft-core";
import {
  createConvergeComputation,
  createDebateComputation,
  createDialecticComputation,
} from "../operators";
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
import type { TeamConfig, TeamMode, TeamResult } from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// TEAM CLASS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Team - A reusable agent team definition.
 *
 * @remarks
 * Teams encapsulate a coordination pattern (debate, dialectic, converge, or broadcast)
 * with a fixed set of agents. Once defined, a team can be invoked from anywhere
 * using `ask()`, `consensus()`, `solve()`, or `refine()` methods.
 *
 * @example Debate Team (Unanimous Sign-Off)
 * ```typescript
 * const qaTeam = Team.create({
 *   name: 'qa-team',
 *   description: 'QA sign-off team',
 *   mode: 'debate',
 *   agents: [linter, tester, reviewer],
 *   debateOptions: { maxConsensusAttempts: 2 },
 * });
 *
 * const result = await qaTeam.consensus(codeChanges).run(ctx);
 * ```
 *
 * @example Dialectic Team (Leader-Driven)
 * ```typescript
 * const architectTeam = Team.create({
 *   name: 'architect-team',
 *   description: 'Architecture design team',
 *   mode: 'dialectic',
 *   leader: architect,
 *   advisors: [security, performance, cost],
 *   dialecticOptions: { maxRounds: 5 },
 * });
 *
 * const result = await architectTeam.solve(problem).run(ctx);
 * ```
 *
 * @example Converge Team (Iterative Refinement)
 * ```typescript
 * const editTeam = Team.create({
 *   name: 'edit-team',
 *   mode: 'converge',
 *   agents: [grammar, clarity, style],
 *   convergeOptions: { maxRounds: 10 },
 * });
 *
 * const result = await editTeam.refine(draft).run(ctx);
 * ```
 *
 * 📝 BUILD[F-048-01.08]: Team class for reusable agent coordination
 */
export class Team<T> {
  /** Team name (unique identifier) */
  readonly name: string;

  /** Optional description */
  readonly description?: string;

  /** Coordination mode */
  readonly mode: TeamMode;

  /** Full configuration */
  private readonly config: TeamConfig<T>;

  /**
   * Private constructor - use Team.create() factory method.
   */
  private constructor(config: TeamConfig<T>) {
    this.config = config;
    this.name = config.name;
    this.description = config.description;
    this.mode = config.mode;

    this.validateConfig();
  }

  /**
   * Create a new Team instance.
   *
   * @param config - Team configuration
   * @returns A new Team instance
   * @throws Error if configuration is invalid for the specified mode
   *
   * @example
   * ```typescript
   * const team = Team.create({
   *   name: 'my-team',
   *   mode: 'debate',
   *   agents: [agent1, agent2, agent3],
   * });
   * ```
   */
  static create<T>(config: TeamConfig<T>): Team<T> {
    return new Team<T>(config);
  }

  /**
   * Validate configuration based on mode.
   * @throws Error if required fields are missing for the mode
   */
  private validateConfig(): void {
    switch (this.config.mode) {
      case "dialectic":
        if (!this.config.leader) {
          throw new Error(
            `Team '${this.name}': dialectic mode requires 'leader' field`,
          );
        }
        if (!this.config.advisors || this.config.advisors.length === 0) {
          throw new Error(
            `Team '${this.name}': dialectic mode requires 'advisors' array`,
          );
        }
        break;

      case "debate":
      case "converge":
        if (!this.config.agents || this.config.agents.length === 0) {
          throw new Error(
            `Team '${this.name}': ${this.config.mode} mode requires 'agents' array`,
          );
        }
        break;

      case "broadcast":
        if (!this.config.agents || this.config.agents.length === 0) {
          throw new Error(
            `Team '${this.name}': broadcast mode requires 'agents' array`,
          );
        }
        break;

      default:
        throw new Error(
          `Team '${this.name}': unknown mode '${this.config.mode}'`,
        );
    }
  }

  /**
   * Generic ask method - routes to the correct coordination based on mode.
   *
   * @param input - The input to process
   * @returns AgentUnit producing a TeamResult
   *
   * @example
   * ```typescript
   * const result = await team.ask(input).run(ctx);
   * console.log(result.value.success);
   * ```
   */
  ask(input: T): AgentUnit<TeamResult<T>> {
    const startTime = Date.now();

    switch (this.config.mode) {
      case "debate":
        return this.runDebate(input, startTime);

      case "dialectic":
        return this.runDialectic(input, startTime);

      case "converge":
        return this.runConverge(input, startTime);

      case "broadcast":
        return this.runBroadcast(input, startTime);

      default:
        throw new Error(`Unknown team mode: ${this.config.mode}`);
    }
  }

  /**
   * Debate-specific method (unanimous consensus).
   * Only valid for teams with mode: 'debate'.
   *
   * @param input - The input to debate
   * @returns AgentUnit producing a DebateResult
   * @throws Error if team mode is not 'debate'
   */
  consensus(input: T): AgentUnit<DebateResult<T>> {
    if (this.config.mode !== "debate") {
      throw new Error(
        `Team '${this.name}': consensus() only valid for debate mode (current: ${this.config.mode})`,
      );
    }

    const agents = this.config.agents as DebateAgent<T>[];
    const options = this.config.options as DebateOptions;
    return AgentUnit.from(
      createDebateComputation(input, agents, options ?? {}),
    ) as AgentUnit<DebateResult<T>>;
  }

  /**
   * Dialectic-specific method (leader-driven synthesis).
   * Only valid for teams with mode: 'dialectic'.
   *
   * @param input - The problem to solve
   * @returns AgentUnit producing a DialecticResult
   * @throws Error if team mode is not 'dialectic'
   */
  solve(input: T): AgentUnit<DialecticResult<T>> {
    if (this.config.mode !== "dialectic") {
      throw new Error(
        `Team '${this.name}': solve() only valid for dialectic mode (current: ${this.config.mode})`,
      );
    }

    const leader = this.config.leader as LeaderAgent<T>;
    const advisors = this.config.advisors as AdvisorAgent<T>[];
    const options = this.config.options as DialecticOptions;
    return AgentUnit.from(
      createDialecticComputation(input, leader, advisors, options ?? {}),
    ) as AgentUnit<DialecticResult<T>>;
  }

  /**
   * Converge-specific method (iterative refinement).
   * Only valid for teams with mode: 'converge'.
   *
   * @param input - The initial state to refine
   * @returns AgentUnit producing a ConvergeResult
   * @throws Error if team mode is not 'converge'
   */
  refine(input: T): AgentUnit<ConvergeResult<T>> {
    if (this.config.mode !== "converge") {
      throw new Error(
        `Team '${this.name}': refine() only valid for converge mode (current: ${this.config.mode})`,
      );
    }

    const agents = this.config.agents as ConvergentAgent<T>[];
    const options = this.config.options as ConvergeOptions;
    return AgentUnit.from(
      createConvergeComputation(input, agents, options ?? {}),
    ) as AgentUnit<ConvergeResult<T>>;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PRIVATE IMPLEMENTATION METHODS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Run debate coordination and wrap in TeamResult.
   */
  private runDebate(input: T, startTime: number): AgentUnit<TeamResult<T>> {
    const agents = this.config.agents as DebateAgent<T>[];
    const options = this.config.options as DebateOptions;
    const unit = AgentUnit.from(
      createDebateComputation(input, agents, options ?? {}),
    ) as AgentUnit<DebateResult<T>>;
    return unit.map((result) => this.wrapResult(result, startTime));
  }

  /**
   * Run dialectic coordination and wrap in TeamResult.
   */
  private runDialectic(input: T, startTime: number): AgentUnit<TeamResult<T>> {
    const leader = this.config.leader as LeaderAgent<T>;
    const advisors = this.config.advisors as AdvisorAgent<T>[];
    const options = this.config.options as DialecticOptions;
    const unit = AgentUnit.from(
      createDialecticComputation(input, leader, advisors, options ?? {}),
    ) as AgentUnit<DialecticResult<T>>;
    return unit.map((result) => this.wrapResult(result, startTime));
  }

  /**
   * Run converge coordination and wrap in TeamResult.
   */
  private runConverge(input: T, startTime: number): AgentUnit<TeamResult<T>> {
    const agents = this.config.agents as ConvergentAgent<T>[];
    const options = this.config.options as ConvergeOptions;
    const unit = AgentUnit.from(
      createConvergeComputation(input, agents, options ?? {}),
    ) as AgentUnit<ConvergeResult<T>>;
    return unit.map((result) => this.wrapResult(result, startTime));
  }

  /**
   * Run broadcast (parallel execution) and wrap in TeamResult.
   */
  private runBroadcast(input: T, startTime: number): AgentUnit<TeamResult<T>> {
    // Broadcast runs all agents in parallel and collects results
    // For now, use converge with parallel: true and maxRounds: 1
    const baseOptions = (this.config.options as ConvergeOptions) || {};
    const broadcastOptions: ConvergeOptions = {
      ...baseOptions,
      parallel: true,
      maxRounds: 1,
    };

    const unit = AgentUnit.from(
      createConvergeComputation(
        input,
        this.config.agents as ConvergentAgent<T>[],
        broadcastOptions,
      ),
    ) as AgentUnit<ConvergeResult<T>>;
    return unit.map((result) => this.wrapResult(result, startTime));
  }

  /**
   * Wrap any coordination result in a TeamResult.
   */
  private wrapResult(
    result: DebateResult<T> | DialecticResult<T> | ConvergeResult<T>,
    startTime: number,
  ): TeamResult<T> {
    const durationMs = Date.now() - startTime;

    // Determine outcome, result, and agent count based on result type
    let outcome: string;
    let output: T;
    let rounds: number;
    let agentCount: number;

    if ("outcome" in result && "finalState" in result) {
      // DebateResult
      const debateResult = result as DebateResult<T>;
      outcome = debateResult.outcome;
      output = debateResult.finalState;
      rounds = debateResult.rounds;
      agentCount = this.config.agents?.length ?? 0;

      return {
        team: this.name,
        mode: this.config.mode,
        outcome,
        result: output,
        metadata: { rounds, durationMs, agentCount },
        debate: debateResult,
      };
    } else if ("outcome" in result && "finalThesis" in result) {
      // DialecticResult
      const dialecticResult = result as DialecticResult<T>;
      outcome = dialecticResult.outcome;
      output = dialecticResult.finalThesis;
      rounds = dialecticResult.rounds;
      agentCount = (this.config.advisors?.length ?? 0) + 1; // advisors + leader

      return {
        team: this.name,
        mode: this.config.mode,
        outcome,
        result: output,
        metadata: { rounds, durationMs, agentCount },
        dialectic: dialecticResult,
      };
    } else {
      // ConvergeResult
      const convergeResult = result as ConvergeResult<T>;
      outcome = convergeResult.converged ? "converged" : "max-rounds";
      output = convergeResult.finalResult;
      rounds = convergeResult.rounds;
      agentCount = this.config.agents?.length ?? 0;

      return {
        team: this.name,
        mode: this.config.mode,
        outcome,
        result: output,
        metadata: { rounds, durationMs, agentCount },
        converge: convergeResult,
      };
    }
  }
}
