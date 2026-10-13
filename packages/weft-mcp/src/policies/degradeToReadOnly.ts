/**
 * @fileoverview Policy: Untrusted servers degrade to read-only access
 * @module weft-mcp/policies
 * @since 0.1.0
 */

import type { MCPEvidence, MCPPolicyVerdict, MCPTrustPolicy } from "../types";

/**
 * Degrades evidence that does not carry both a pre-set "allow" verdict and a
 * non-empty provenance chain.
 *
 * For a fresh call both conditions are always true (set by `createMCPEvidence`
 * before policies run), so this policy returns "allow" by default.
 *
 * **What this does NOT do:** it does not verify server identity or check an
 * external attestation source. "Attested" here means the client-generated
 * fields are structurally present, not that an external authority approved them.
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
