/**
 * @fileoverview Teams module exports for @symplek/core
 * @description Re-exports Team, TeamRegistry, and types
 * @module @symplek/core/teams
 * @since 1.0.0-beta.1
 *
 * 📝 BUILD[F-048-01.10]: Teams barrel exports
 */

// Export Team class (Story 01.08)
export { Team } from "./Team";
// Export TeamRegistry class and singleton (Story 01.09)
export { TeamRegistry, teams } from "./TeamRegistry";
// Export types
export type { TeamConfig, TeamMode, TeamResult } from "./types";
