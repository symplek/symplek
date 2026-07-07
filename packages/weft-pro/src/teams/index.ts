/**
 * @fileoverview Teams module exports for weft-core
 * @description Re-exports Team, TeamRegistry, and types
 * @module weft-core/teams
 * @since 1.0.0-beta.2
 *
 * 📝 BUILD[F-048-01.10]: Teams barrel exports
 */

// License gate — FATAL #6 HARDENING (2026-07-07)
import "../license-gate";

// Export Team class (Story 01.08)
export { Team } from "./Team";
// Export TeamRegistry class and singleton (Story 01.09)
export { TeamRegistry, teams } from "./TeamRegistry";
// Export types
export type { TeamConfig, TeamMode, TeamResult } from "./types";
