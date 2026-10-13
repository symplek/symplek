/**
 * @fileoverview Teams module (re-export from weft-core)
 * @description License-gated re-export. Implementation lives in weft-core.
 * @module weft-pro/teams
 * @since 1.0.0-beta.1
 */

// License gate — fires at import time
import "../license-gate";

export type { TeamConfig, TeamMode, TeamResult } from "weft-core";
export { Team, TeamRegistry, teams } from "weft-core";
