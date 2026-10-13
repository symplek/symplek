/**
 * @fileoverview Policy: Only allow results from registry-attested MCP servers
 * @module @symplek/mcp/policies
 * @since 0.1.0
 */

import type { MCPEvidence, MCPPolicyVerdict, MCPTrustPolicy } from "../types";

/**
 * Structural pre-flight check on client-generated evidence fields.
 *
 * Checks two fields that `createMCPEvidence` writes before policies run:
 *   - `policyVerdict`: must be "allow" (the default for a fresh call).
 *   - `provenanceChain`: must be non-empty (always true for a fresh call).
 *
 * **What this does NOT do:** it does not consult an external registry, verify
 * server identity, or read any attested flag. A tool on an unknown server
 * passes this policy if the client created the evidence object normally.
 * To enforce real registry-based trust, supply a custom policy that reads
 * your own trust store.
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
