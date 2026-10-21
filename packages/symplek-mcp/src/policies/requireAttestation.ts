/**
 * @fileoverview Policy: Results must carry provenance attestation
 * @module @symplek/mcp/policies
 * @since 0.1.0
 */

import type { MCPEvidence, MCPPolicyVerdict, MCPTrustPolicy } from "../types";

/**
 * Requires evidence to have a non-empty provenance chain proving origin.
 * Empty provenance means the data appeared from nowhere — quarantine it
 * until origin can be established.
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
