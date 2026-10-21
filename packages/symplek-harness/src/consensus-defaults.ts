/** @module ConsensusDefaults - Per-tier threshold and minimum-veto config for @symplek/harness */

import type { ImpactTier } from "./types";

export interface ConsensusDefaults {
  readonly threshold: number;
  readonly minVetoers: number;
}

const TIER_MAP: Record<ImpactTier, ConsensusDefaults> = {
  P0: { threshold: 0.95, minVetoers: 3 },
  P1: { threshold: 0.85, minVetoers: 2 },
  P2: { threshold: 0.75, minVetoers: 1 },
  P3: { threshold: 0.6, minVetoers: 0 },
};

/**
 * Returns the recommended consensus threshold and minimum veto count for the
 * given impact tier. Feed the result into your consensus operator to skip
 * manual threshold configuration.
 */
export function getConsensusDefaults(tier: ImpactTier): ConsensusDefaults {
  return TIER_MAP[tier];
}
