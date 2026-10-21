/**
 * @fileoverview Trust Policy Engine — chains and evaluates MCP trust policies
 * @module @symplek/mcp/policies
 * @since 0.1.0
 *
 * Verdict precedence: deny > quarantine > degrade > allow.
 * A single "deny" short-circuits — remaining policies are skipped.
 */

import type { MCPEvidence, MCPPolicyVerdict, MCPTrustPolicy } from "../types";

import { allowTrustedOnly } from "./allowTrustedOnly";
import { degradeToReadOnly } from "./degradeToReadOnly";
import { requireAttestation } from "./requireAttestation";
import { requireTwoSources } from "./requireTwoSources";

// ---------------------------------------------------------------------------
// Result type
// ---------------------------------------------------------------------------

export interface PolicyEvaluationResult {
  finalVerdict: MCPPolicyVerdict;
  policyResults: Array<{
    policy: string;
    verdict: MCPPolicyVerdict;
  }>;
  /** Set when the final verdict is "deny". */
  deniedBy?: string;
}

// ---------------------------------------------------------------------------
// Severity ranking (internal)
// ---------------------------------------------------------------------------

function verdictSeverity(v: MCPPolicyVerdict): number {
  switch (v) {
    case "allow":
      return 0;
    case "degrade":
      return 1;
    case "quarantine":
      return 2;
    case "deny":
      return 3;
  }
}

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------

export class TrustPolicyEngine {
  private readonly policies: MCPTrustPolicy[] = [];

  constructor(policies?: MCPTrustPolicy[]) {
    if (policies) {
      this.policies = [...policies];
    }
  }

  addPolicy(policy: MCPTrustPolicy): this {
    this.policies.push(policy);
    return this;
  }

  /**
   * Evaluate evidence against all configured policies.
   * Short-circuits on the first "deny" — no further policies run.
   * Otherwise returns the most severe non-deny verdict observed.
   */
  evaluate(evidence: MCPEvidence<unknown>): PolicyEvaluationResult {
    const policyResults: PolicyEvaluationResult["policyResults"] = [];
    let worstVerdict: MCPPolicyVerdict = "allow";

    for (const policy of this.policies) {
      const verdict = policy.evaluate(evidence);
      policyResults.push({ policy: policy.name, verdict });

      if (verdict === "deny") {
        return {
          finalVerdict: "deny",
          policyResults,
          deniedBy: policy.name,
        };
      }

      if (verdictSeverity(verdict) > verdictSeverity(worstVerdict)) {
        worstVerdict = verdict;
      }
    }

    return { finalVerdict: worstVerdict, policyResults };
  }

  get policyCount(): number {
    return this.policies.length;
  }
}

// ---------------------------------------------------------------------------
// Default factory
// ---------------------------------------------------------------------------

/**
 * Create a TrustPolicyEngine pre-loaded with all 4 built-in policies
 * in recommended evaluation order.
 */
export function createDefaultPolicyEngine(): TrustPolicyEngine {
  return new TrustPolicyEngine([
    allowTrustedOnly,
    requireAttestation,
    requireTwoSources,
    degradeToReadOnly,
  ]);
}
