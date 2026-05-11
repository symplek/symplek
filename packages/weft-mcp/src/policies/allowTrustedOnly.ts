/**
 * @fileoverview Policy: Only allow results from registry-attested MCP servers
 * @module @weft/mcp/policies
 * @since 0.1.0
 */

import type { MCPEvidence, MCPPolicyVerdict, MCPTrustPolicy } from "../types";

/**
 * Rejects evidence from servers that haven't been attested in the trust registry.
 * Checks both the pre-set policy verdict and provenance chain presence.
 * A missing provenance chain means origin can't be verified — deny.
 */
export const allowTrustedOnly: MCPTrustPolicy = {
  name: "allowTrustedOnly",
  evaluate: (evidence: MCPEvidence<unknown>): MCPPolicyVerdict => {
    if (evidence.mcp.policyVerdict !== "allow") {
      return "deny";
    }
    if (evidence.mcp.provenanceChain.length === 0) {
      return "deny";
    }
    return "allow";
  },
};
