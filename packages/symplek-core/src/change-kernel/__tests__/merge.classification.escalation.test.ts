import { describe, expect, it } from "vitest";

import {
  type ClassifiedConflict,
  classifyConflict,
  escalateConflicts,
  mergePatchSets,
  type PatchOp,
  type PatchSet,
} from "../index";

function setWithOp(op: PatchOp, baseRef = "v1"): PatchSet<PatchOp> {
  return {
    patchSetId: `PS-${op.opId}`,
    baseRef,
    authorType: "agent",
    consultationTrace: [],
    riskTier: "P1",
    confidence: 0.9,
    createdAt: 1,
    ops: [op],
  };
}

describe("merge determinism", () => {
  it("auto-merges non-overlapping ops", () => {
    const base = setWithOp({ opId: "A", kind: "task.upsert", targetId: "T1" });
    const current = {
      ...base,
      patchSetId: "current",
      baseRef: "v2",
      ops: [{ opId: "B", kind: "task.upsert", targetId: "T2" }],
    };
    const proposed = {
      ...base,
      patchSetId: "proposed",
      baseRef: "v1",
      ops: [{ opId: "C", kind: "task.upsert", targetId: "T3" }],
    };

    const merged = mergePatchSets(base, current, proposed);
    expect(merged.conflicts).toHaveLength(0);
    expect(merged.autoMerged).toBe(true);
    expect(merged.merged.ops.map((op) => op.opId)).toEqual(["B", "C"]);
  });

  it("is deterministic over repeated runs", () => {
    const base = setWithOp({ opId: "A", kind: "task.upsert", targetId: "T1" });
    const current = {
      ...base,
      baseRef: "v2",
      ops: [
        { opId: "B", kind: "task.upsert", targetId: "T1", payload: { x: 1 } },
      ],
    };
    const proposed = {
      ...base,
      baseRef: "v1",
      ops: [
        { opId: "C", kind: "task.upsert", targetId: "T1", payload: { x: 2 } },
      ],
    };

    const first = mergePatchSets(base, current, proposed);
    for (let i = 0; i < 20; i += 1) {
      expect(mergePatchSets(base, current, proposed)).toEqual(first);
    }
  });
});

describe("classification and escalation", () => {
  it("classifies policy from context and blocks", () => {
    const conflict = {
      conflictId: "c1",
      targetId: "T1",
      kind: "task.upsert",
      ops: [
        { opId: "a", kind: "task.upsert", targetId: "T1" },
        { opId: "b", kind: "task.upsert", targetId: "T1" },
      ] as [PatchOp, PatchOp],
    };

    const classified = classifyConflict(conflict, {
      hints: { class: "policy" },
    });
    expect(classified.class).toBe("policy");
    expect(classified.resolution).toBe("block");
  });

  it("enforces no-silent-drop invariant", () => {
    const conflicts: ClassifiedConflict[] = [
      {
        conflictId: "c1",
        targetId: "T1",
        kind: "task.upsert",
        class: "structural",
        resolution: "auto",
        ops: [
          { opId: "a", kind: "task.upsert", targetId: "T1" },
          { opId: "b", kind: "task.upsert", targetId: "T1" },
        ],
      },
      {
        conflictId: "c2",
        targetId: "T2",
        kind: "task.upsert",
        class: "policy",
        resolution: "block",
        ops: [
          { opId: "c", kind: "task.upsert", targetId: "T2" },
          { opId: "d", kind: "task.upsert", targetId: "T2" },
        ],
      },
    ];

    const result = escalateConflicts(conflicts, {
      structural: (request) => ({
        status: "resolved",
        chosenOption: request.options[0],
        actor: { type: "agent", id: "resolver" },
        reason: "selected best option",
        timestamp: 1,
      }),
    });

    const accounted =
      result.resolved.length + result.deferred.length + result.blocked.length;
    expect(accounted).toBe(conflicts.length);
    expect(result.blocked).toHaveLength(1);
  });
});
