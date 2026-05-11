import { describe, expect, it } from "vitest";

import {
  deserializePatchSet,
  evaluatePostconditions,
  evaluatePreconditions,
  type PatchOp,
  type PatchSet,
  postconditionEvaluators,
  preconditionEvaluators,
  serializePatchSet,
  validatePatchSet,
} from "../index";

function validPatchSet(): PatchSet<PatchOp> {
  return {
    patchSetId: "PS-001",
    baseRef: "snapshot-v1",
    authorType: "agent",
    consultationTrace: [],
    riskTier: "P1",
    confidence: 0.9,
    createdAt: Date.now(),
    ops: [
      {
        opId: "op-1",
        kind: "task.upsert",
        targetId: "T1",
        payload: { startDay: 5 },
      },
    ],
  };
}

describe("patch set validation", () => {
  it("accepts a valid patch set", () => {
    const result = validatePatchSet(validPatchSet());
    expect(result.ok).toBe(true);
  });

  it("rejects invalid confidence", () => {
    const input = validPatchSet();
    input.confidence = 1.5;
    const result = validatePatchSet(input);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.path === "confidence")).toBe(true);
    }
  });

  it("round-trips deterministically", () => {
    const patchSet = validPatchSet();
    const json1 = serializePatchSet(patchSet);
    const parsed = deserializePatchSet(json1);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      const json2 = serializePatchSet(parsed.value);
      expect(json1).toEqual(json2);
    }
  });

  it("rejects malformed JSON in deserialize", () => {
    const parsed = deserializePatchSet("{ broken");
    expect(parsed.ok).toBe(false);
  });
});

describe("precondition and postcondition semantics", () => {
  it("fails fast on first precondition violation", () => {
    preconditionEvaluators.register("task.exists", {
      evaluate: () => ({ ok: true }),
    });

    preconditionEvaluators.register("dep.exists", {
      evaluate: () => ({ ok: false, reason: "dep missing" }),
    });

    const ops: PatchOp[] = [
      {
        opId: "1",
        kind: "task.upsert",
        targetId: "T1",
        preconditions: [{ type: "task.exists", descriptor: "task.exists:T1" }],
      },
      {
        opId: "2",
        kind: "dep.add",
        targetId: "D1",
        preconditions: [{ type: "dep.exists", descriptor: "dep.exists:D1" }],
      },
      {
        opId: "3",
        kind: "task.upsert",
        targetId: "T2",
        preconditions: [{ type: "task.exists", descriptor: "task.exists:T2" }],
      },
    ];

    const result = evaluatePreconditions(ops, {});
    expect(result.passed).toBe(false);
    expect(result.failedAt).toBe("2");
    expect(result.evaluatedCount).toBe(2);
  });

  it("supports adapter postcondition evaluators", () => {
    postconditionEvaluators.register("no-temporal-overlap", {
      evaluate: () => ({ ok: false, reason: "temporal overlap T1/T2" }),
    });

    const result = evaluatePostconditions(
      [
        {
          opId: "op-1",
          kind: "task.upsert",
          targetId: "T1",
          postconditions: [
            {
              type: "no-temporal-overlap",
              descriptor: "no-temporal-overlap:T1",
            },
          ],
        },
      ],
      {},
      {},
    );

    expect(result.passed).toBe(false);
    expect(result.violations[0]?.reason).toContain("temporal overlap");
  });
});
