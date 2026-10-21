/**
 * @fileoverview Teams module (re-export from @symplek/core)
 * @description License-gated re-export. Implementation lives in @symplek/core.
 * @module @symplek/pro/teams
 * @since 1.0.0-beta.1
 */

// License gate — fires at import time
import "../license-gate";

export type { TeamConfig, TeamMode, TeamResult } from "@symplek/core";
export { Team, TeamRegistry, teams } from "@symplek/core";
