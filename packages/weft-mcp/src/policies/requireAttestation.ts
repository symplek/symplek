/**
 * @fileoverview Policy: Results must carry provenance attestation
 * @module weft-mcp/policies
 * @since 0.1.0
 */

import type { MCPEvidence, MCPPolicyVerdict, MCPTrustPolicy } from "../types";

/**
 * Structural provenance-chain check.
 *
 * Quarantines evidence with an empty `provenanceChain`. In practice
 * `createMCPEvidence` always adds a self-generated entry, so this policy
 * returns "allow" for every fresh call.
 *
 * **What this does NOT do:** it does not verify the origin recorded in the
 * chain against any external registry or signature. It only confirms that the
 * chain is structurally present.
 */
export const requireAttestation: MCPTrustPolicy = {
  name: "requireAttestation",
  evaluate: (evidence: MCPEvidence<unknown>): MCPPolicyVerdict => {
    if (evidence.mcp.provenanceChain.length === 0) {
      return "quarantine";
    }
    return "allow";
  },
};
