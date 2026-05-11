import type {
  Actor,
  ApprovalAction,
  ApprovalPolicy,
  Decision,
  DecisionRecord,
  OverrideCapture,
  PatchOp,
  PatchSet,
  RejectionCapture,
  RejectionCategory,
  RiskTier,
} from "./types";

const BASE_POLICIES: Record<RiskTier, ApprovalPolicy> = {
  P0: {
    tier: "P0",
    requiresExplicitApproval: true,
    allowsAutoApproval: false,
    undoWindowMs: 0,
    escalationRequired: true,
    bundlingAllowed: false,
  },
  P1: {
    tier: "P1",
    requiresExplicitApproval: true,
    allowsAutoApproval: false,
    undoWindowMs: 0,
    escalationRequired: false,
    bundlingAllowed: false,
  },
  P2: {
    tier: "P2",
    requiresExplicitApproval: false,
    allowsAutoApproval: true,
    undoWindowMs: 30000,
    escalationRequired: false,
    bundlingAllowed: true,
  },
};

function clonePolicy(policy: ApprovalPolicy): ApprovalPolicy {
  return { ...policy };
}

function assertNoLoosening(
  base: ApprovalPolicy,
  candidate: ApprovalPolicy,
): void {
  if (base.tier === "P0" || base.tier === "P1") {
    if (!candidate.requiresExplicitApproval && base.requiresExplicitApproval) {
      throw new Error(`cannot loosen ${base.tier} policy`);
    }
    if (candidate.allowsAutoApproval && !base.allowsAutoApproval) {
      throw new Error(`cannot loosen ${base.tier} policy`);
    }
  }

  if (base.tier === "P0" && candidate.bundlingAllowed) {
    throw new Error("cannot loosen P0 policy");
  }
}

export class ApprovalPolicyRegistry {
  private readonly overrides = new Map<RiskTier, ApprovalPolicy>();

  register(override: ApprovalPolicy): void {
    const baseline = BASE_POLICIES[override.tier];
    assertNoLoosening(baseline, override);
    this.overrides.set(override.tier, clonePolicy(override));
  }

  get(riskTier: RiskTier): ApprovalPolicy {
    return clonePolicy(this.overrides.get(riskTier) ?? BASE_POLICIES[riskTier]);
  }
}

export const approvalPolicyRegistry = new ApprovalPolicyRegistry();

export function getApprovalPolicy(riskTier: RiskTier): ApprovalPolicy {
  return approvalPolicyRegistry.get(riskTier);
}

export function routeToGate(
  patchSet: PatchSet<PatchOp>,
  policy: ApprovalPolicy,
): ApprovalAction {
  if (patchSet.riskTier === "P0") {
    return "require_approval";
  }

  if (patchSet.riskTier === "P1") {
    return "require_approval_with_alternatives";
  }

  return policy.allowsAutoApproval ? "auto_approve" : "require_approval";
}

const decisionStore = new Map<string, DecisionRecord[]>();
const rejectionStore: RejectionCapture[] = [];
const overrideStore: OverrideCapture[] = [];
const decisionTierIndex = new Map<string, RiskTier>();

function freezeRecord(record: DecisionRecord): DecisionRecord {
  return Object.freeze({
    ...record,
    actor: { ...record.actor },
    policyApplied: { ...record.policyApplied },
  });
}

export function createDecisionRecord(
  patchSet: PatchSet<PatchOp>,
  decision: Decision,
  actor: Actor,
  reason = "",
): DecisionRecord {
  const policyApplied = getApprovalPolicy(patchSet.riskTier);
  const record: DecisionRecord = {
    decisionId: `DR-${patchSet.patchSetId}-${Date.now()}`,
    patchSetId: patchSet.patchSetId,
    decision,
    actor,
    policyApplied,
    reason,
    timestamp: Date.now(),
    consultationTraceRef: patchSet.patchSetId,
  };

  const immutableRecord = freezeRecord(record);
  const existing = decisionStore.get(patchSet.patchSetId) ?? [];
  decisionStore.set(patchSet.patchSetId, [...existing, immutableRecord]);
  decisionTierIndex.set(immutableRecord.decisionId, patchSet.riskTier);
  return immutableRecord;
}

export function queryDecisionsByPatch(patchSetId: string): DecisionRecord[] {
  return [...(decisionStore.get(patchSetId) ?? [])];
}

export function enforceLinkageInvariant(patchSetIds: string[]): boolean {
  return patchSetIds.every(
    (patchSetId) => (decisionStore.get(patchSetId)?.length ?? 0) >= 1,
  );
}

export type RejectionReason = {
  category: RejectionCategory;
  text: string;
};

export function captureRejection(
  decisionRecordId: string,
  capture: RejectionCapture,
): void {
  const tier = decisionTierIndex.get(decisionRecordId);
  if ((tier === "P0" || tier === "P1") && capture.reason.trim().length === 0) {
    throw new Error(`${tier} rejection requires non-empty reason`);
  }

  rejectionStore.push({ ...capture, decisionRecordId });
}

export function captureOverride(
  decisionRecordId: string,
  capture: OverrideCapture,
): void {
  const tier = decisionTierIndex.get(decisionRecordId);
  if (!capture.overrideReason || capture.overrideReason.trim().length === 0) {
    throw new Error("override reason is required");
  }

  if (tier === "P0" && !capture.riskAcknowledgement) {
    throw new Error("P0 override requires explicit risk acknowledgement");
  }

  if (
    capture.policyViolations.some(
      (violation) => violation === "non_overridable_policy",
    )
  ) {
    throw new Error("cannot override non-overridable policy violations");
  }

  overrideStore.push({ ...capture, decisionRecordId });
}

export function getRejectionsByCategory(
  category: RejectionCategory,
): RejectionCapture[] {
  return rejectionStore.filter((entry) => entry.rejectionCategory === category);
}

export function __clearApprovalStoresForTests(): void {
  decisionStore.clear();
  rejectionStore.splice(0, rejectionStore.length);
  overrideStore.splice(0, overrideStore.length);
  decisionTierIndex.clear();
}
