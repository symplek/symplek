/**
 * @fileoverview Policy: Results need corroboration from at least two sources
 * @module @weft/mcp/policies
 * @since 0.1.0
 */

import type { MCPEvidence, MCPPolicyVerdict, MCPTrustPolicy } from "../types";

/**
 * Requires corroboration from at least 2 independent sources for full trust.
 * Single-source evidence gets degraded — usable but not fully trusted.
 */
export const requireTwoSources: MCPTrustPolicy = {
  name: "requireTwoSources",
  evaluate: (evidence: MCPEvidence<unknown>): MCPPolicyVerdict => {
    if (evidence.mcp.corroboratedBy.length >= 2) {
      return "allow";
    }
    return "degrade";
  },
};
