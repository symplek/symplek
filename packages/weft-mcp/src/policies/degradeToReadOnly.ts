/**
 * @fileoverview Policy: Untrusted servers degrade to read-only access
 * @module @weft/mcp/policies
 * @since 0.1.0
 */

import type { MCPEvidence, MCPPolicyVerdict, MCPTrustPolicy } from "../types";

/**
 * Non-attested evidence is degraded rather than denied outright,
 * allowing read operations while blocking mutations.
 * Attested = pre-approved verdict AND traceable provenance.
 */
export const degradeToReadOnly: MCPTrustPolicy = {
  name: "degradeToReadOnly",
  evaluate: (evidence: MCPEvidence<unknown>): MCPPolicyVerdict => {
    if (
      evidence.mcp.policyVerdict === "allow" &&
      evidence.mcp.provenanceChain.length > 0
    ) {
      return "allow";
    }
    return "degrade";
  },
};
