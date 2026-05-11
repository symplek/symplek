/**
 * @fileoverview TeamRegistry - Global registry for named teams
 * @description Register teams once, invoke by name from anywhere
 * @module weft-core/teams/TeamRegistry
 * @since 1.0.0-beta.1
 *
 * 📝 BUILD[F-048-01.09]: TeamRegistry implementation
 */

import type { AgentUnit } from "weft-core";
import type { Team } from "./Team";
import type { TeamResult } from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// TEAM REGISTRY CLASS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * TeamRegistry - Global registry for named teams.
 *
 * @remarks
 * The TeamRegistry provides a central location to register and retrieve teams.
 * This enables teams to be defined in one place and invoked by name from anywhere
 * in the application.
 *
 * @example Basic Usage
 * ```typescript
 * import { teams, Team } from 'weft-core';
 *
 * // Register teams at app startup
 * const qaTeam = Team.create({ name: 'qa', mode: 'debate', agents: [...] });
 * teams.register(qaTeam);
 *
 * // Invoke by name from anywhere
 * const result = await teams.ask('qa', codeChanges).run(ctx);
 * ```
 *
 * @example Type-Safe Retrieval
 * ```typescript
 * // Get team with explicit type parameter
 * const team = teams.get<CodeReview>('qa');
 * const result = await team.consensus(review).run(ctx);
 * ```
 *
 * @example Listing and Checking
 * ```typescript
 * // List all registered teams
 * console.log(teams.list()); // ['qa', 'architect', 'edit']
 *
 * // Check if team exists
 * if (teams.has('qa')) {
 *   const result = await teams.ask('qa', input).run(ctx);
 * }
 * ```
 *
 * 📝 BUILD[F-048-01.09]: TeamRegistry for global team lookup
 */
export class TeamRegistry {
  /** Internal map of team name to Team instance */
  private teamMap: Map<string, Team<unknown>> = new Map();

  /**
   * Register a team with the registry.
   *
   * @param team - The team to register
   * @remarks If a team with the same name exists, it will be overwritten with a warning.
   *
   * @example
   * ```typescript
   * const team = Team.create({ name: 'qa', mode: 'debate', agents: [...] });
   * teams.register(team);
   * ```
   */
  register<T>(team: Team<T>): void {
    if (this.teamMap.has(team.name)) {
      console.warn(`TeamRegistry: Overwriting team '${team.name}'`);
    }
    this.teamMap.set(team.name, team as Team<unknown>);
  }

  /**
   * Get a team by name.
   *
   * @param name - The team name to look up
   * @returns The team instance
   * @throws Error if team not found
   *
   * @example
   * ```typescript
   * const team = teams.get<CodeReview>('qa');
   * ```
   */
  get<T>(name: string): Team<T> {
    const team = this.teamMap.get(name);
    if (!team) {
      throw new Error(`Team '${name}' not found in registry`);
    }
    return team as Team<T>;
  }

  /**
   * Check if a team exists in the registry.
   *
   * @param name - The team name to check
   * @returns true if team exists
   *
   * @example
   * ```typescript
   * if (teams.has('qa')) { ... }
   * ```
   */
  has(name: string): boolean {
    return this.teamMap.has(name);
  }

  /**
   * List all registered team names.
   *
   * @returns Array of team names
   *
   * @example
   * ```typescript
   * console.log(teams.list()); // ['qa', 'architect', 'edit']
   * ```
   */
  list(): string[] {
    return Array.from(this.teamMap.keys());
  }

  /**
   * Remove a team from the registry.
   *
   * @param name - The team name to remove
   * @returns true if team was removed, false if it didn't exist
   *
   * @example
   * ```typescript
   * teams.unregister('old-team');
   * ```
   */
  unregister(name: string): boolean {
    return this.teamMap.delete(name);
  }

  /**
   * Invoke a team's ask() method by name.
   * Shortcut for `teams.get(name).ask(input)`.
   *
   * @param name - The team name
   * @param input - The input to process
   * @returns AgentUnit producing a TeamResult
   * @throws Error if team not found
   *
   * @example
   * ```typescript
   * const result = await teams.ask('qa', codeChanges).run(ctx);
   * ```
   */
  ask<T>(name: string, input: T): AgentUnit<TeamResult<T>> {
    return this.get<T>(name).ask(input);
  }

  /**
   * Clear all registered teams.
   * Useful for testing.
   */
  clear(): void {
    this.teamMap.clear();
  }

  /**
   * Get the number of registered teams.
   */
  get size(): number {
    return this.teamMap.size;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// SINGLETON INSTANCE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Global team registry singleton.
 *
 * @example
 * ```typescript
 * import { teams, Team } from 'weft-core';
 *
 * // Register
 * teams.register(Team.create({ name: 'qa', ... }));
 *
 * // Invoke
 * const result = await teams.ask('qa', input).run(ctx);
 * ```
 */
export const teams = new TeamRegistry();
