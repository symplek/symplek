/**
 * @fileoverview MCP trust policy barrel exports
 * @module weft-mcp/policies
 * @since 0.1.0
 */

export { allowTrustedOnly } from "./allowTrustedOnly";
export { degradeToReadOnly } from "./degradeToReadOnly";
export { requireAttestation } from "./requireAttestation";
export { requireTwoSources } from "./requireTwoSources";
export type { PolicyEvaluationResult } from "./TrustPolicyEngine";
export {
  createDefaultPolicyEngine,
  TrustPolicyEngine,
} from "./TrustPolicyEngine";
