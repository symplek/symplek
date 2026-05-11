import { describe, expect, it } from "vitest";

import {
  __clearApprovalStoresForTests,
  captureOverride,
  captureRejection,
  convertDecisionToPatchSet,
  createDecisionRecord,
  type DecisionPacket,
  enforceLinkageInvariant,
  getApprovalPolicy,
  getRejectionsByCategory,
  type PatchOp,
  type PatchSet,
  queryDecisionsByPatch,
  routeConsultation,
  routeToGate,
} from "../index";

function buildPacket(): DecisionPacket<PatchOp> {
  return {
    decisionId: "D-1",
    recommendations: [
      {
        action: "Shift phase",
        targetIds: ["P1"],
        priority: 2,
        suggestedOps: [
          {
            opId: "op-2",
            kind: "phase.shift",
            targetId: "P1",
            payload: { deltaDays: 2 },
          },
        ],
      },
      {
        action: "Update task",
        targetIds: ["T1"],
        priority: 1,
        suggestedOps: [{ opId: "op-1", kind: "task.upsert", targetId: "T1" }],
      },
    ],
    consultationTrace: {
      entries: [
        {
          specialist: "schedule",
          confidence: 0.9,
          reasoning: "Critical path shift",
          domain: "schedule",
          consultedAt: Date.now(),
          latencyMs: 120,
          vetoExercised: false,
        },
      ],
      impactTier: "medium",
      totalLatencyMs: 120,
      timedOut: false,
      consensusReached: true,
    },
    riskTier: "P1",
    synthesisMethod: "debate",
    confidence: 0.88,
  };
}

describe("consultation routing and conversion", () => {
  it("routes low impact to max 2 specialists", () => {
    const plan = routeConsultation(
      "low",
      [
        { id: "a", domain: "x", capabilities: ["x"], vetoCapable: false },
        { id: "b", domain: "x", capabilities: ["x"], vetoCapable: false },
        { id: "c", domain: "x", capabilities: ["x"], vetoCapable: false },
      ],
      ["a"],
    );

    expect(plan.specialists.length).toBeLessThanOrEqual(2);
    expect(plan.specialists.some((s) => s.id === "a")).toBe(true);
    expect(plan.budget.maxLatencyMs).toBe(5000);
  });

  it("converts decision packet to validated patch set ordered by priority", () => {
    const result = convertDecisionToPatchSet(buildPacket(), "snapshot-v1");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.patchSet.ops.map((op) => op.opId)).toEqual([
        "op-1",
        "op-2",
      ]);
      expect(result.patchSet.consultationTrace).toHaveLength(1);
      expect(result.patchSet.riskTier).toBe("P1");
    }
  });
});

describe("approval contracts", () => {
  it("enforces policy and decision linkage", () => {
    __clearApprovalStoresForTests();

    const patchSet: PatchSet<PatchOp> = {
      patchSetId: "PS-42",
      baseRef: "snapshot-v1",
      authorType: "agent",
      consultationTrace: [],
      riskTier: "P0",
      ops: [{ opId: "op1", kind: "task.upsert", targetId: "T1" }],
      confidence: 0.9,
      createdAt: Date.now(),
    };

    const policy = getApprovalPolicy("P0");
    expect(routeToGate(patchSet, policy)).toBe("require_approval");

    const record = createDecisionRecord(
      patchSet,
      "rejected",
      { type: "user", id: "u1" },
      "unsafe",
    );
    expect(queryDecisionsByPatch("PS-42")).toHaveLength(1);
    expect(enforceLinkageInvariant(["PS-42"])).toBe(true);

    expect(() =>
      captureRejection(record.decisionId, {
        decisionRecordId: record.decisionId,
        reason: "",
        freeText: "",
        suggestedAlternative: null,
        rejectionCategory: "wrong_scope",
      }),
    ).toThrow("P0 rejection requires non-empty reason");

    expect(() =>
      captureOverride(record.decisionId, {
        decisionRecordId: record.decisionId,
        overrideReason: "force apply",
        overrideActor: { type: "user", id: "u1" },
        riskAcknowledgement: false,
        policyViolations: [],
      }),
    ).toThrow("P0 override requires explicit risk acknowledgement");
  });

  it("stores rejections by category", () => {
    __clearApprovalStoresForTests();

    const patchSet: PatchSet<PatchOp> = {
      patchSetId: "PS-7",
      baseRef: "snapshot-v1",
      authorType: "agent",
      consultationTrace: [],
      riskTier: "P2",
      ops: [{ opId: "op1", kind: "task.upsert", targetId: "T1" }],
      confidence: 0.9,
      createdAt: Date.now(),
    };

    const record = createDecisionRecord(
      patchSet,
      "rejected",
      { type: "user", id: "u1" },
      "not needed",
    );

    captureRejection(record.decisionId, {
      decisionRecordId: record.decisionId,
      reason: "timing",
      freeText: "later",
      suggestedAlternative: "next sprint",
      rejectionCategory: "wrong_timing",
    });

    expect(getRejectionsByCategory("wrong_timing")).toHaveLength(1);
  });
});
