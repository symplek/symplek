/**
 * @module consultation.test
 * @description Regression tests for change-kernel consultation defects fixed in
 * the Wave-3 correctness pass (campaign codebase-review-2026-07-10).
 *
 * Items covered:
 *   N65 — runConsultationWithBudget must bound wall-clock, not just pre-await elapsed
 *   N66 — routeConsultation must surface unavailable required specialists
 */

import { describe, expect, it } from "vitest";
import {
  routeConsultation,
  runConsultationWithBudget,
} from "../change-kernel/consultation";
import type { SpecialistDescriptor } from "../change-kernel/types";

// ─── helpers ──────────────────────────────────────────────────────────────────

function makeSpecialist(id: string): SpecialistDescriptor {
  return { id, domain: "test", capabilities: [], vetoCapable: false };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── N65: per-call deadline ────────────────────────────────────────────────────

describe("runConsultationWithBudget — wall-clock budget (N65)", () => {
  // Vitest 4: options object is the second argument, fn is third.
  it(
    "timedOut:true when a specialist hangs past the budget",
    { timeout: 2000 },
    async () => {
      const s1 = makeSpecialist("fast");
      const s2 = makeSpecialist("slow");

      const plan = routeConsultation("low", [s1, s2]);
      // Override to a tight budget so the test is fast but deterministic.
      plan.budget.maxLatencyMs = 50;

      const runFn = async (s: SpecialistDescriptor): Promise<string> => {
        if (s.id === "slow") {
          await sleep(300); // hangs well past the 50ms budget
        }
        return `done-${s.id}`;
      };

      const outcome = await runConsultationWithBudget(plan, runFn);

      expect(outcome.timedOut).toBe(true);
      // fast specialist completes; slow is cut off by the per-call deadline
      expect(outcome.consulted).toContain("fast");
      expect(outcome.consulted).not.toContain("slow");
    },
  );

  it(
    "timedOut:false when all specialists finish within budget",
    { timeout: 2000 },
    async () => {
      const s1 = makeSpecialist("s1");
      const s2 = makeSpecialist("s2");

      const plan = routeConsultation("low", [s1, s2]);
      plan.budget.maxLatencyMs = 500;

      const runFn = async (s: SpecialistDescriptor): Promise<string> =>
        `result-${s.id}`;

      const outcome = await runConsultationWithBudget(plan, runFn);

      expect(outcome.timedOut).toBe(false);
      expect(outcome.consulted).toEqual(["s1", "s2"]);
      expect(outcome.results).toEqual(["result-s1", "result-s2"]);
    },
  );

  it("timedOut:true when budget is zero (no remaining time before first specialist)", async () => {
    const s1 = makeSpecialist("only");

    const plan = routeConsultation("low", [s1]);
    // maxLatencyMs=0 → remaining <= 0 on the very first pre-loop check.
    plan.budget.maxLatencyMs = 0;

    const runFn = async (): Promise<string> => "x";

    const outcome = await runConsultationWithBudget(plan, runFn);

    expect(outcome.timedOut).toBe(true);
    expect(outcome.consulted).toHaveLength(0);
  });
});

// ─── N66: unmet required specialists ─────────────────────────────────────────

describe("routeConsultation — required specialist availability (N66)", () => {
  it("throws when a required specialist id is not in availableSpecialists", () => {
    const available = [makeSpecialist("risk"), makeSpecialist("compliance")];

    expect(() =>
      routeConsultation("high", available, ["risk", "security"]),
    ).toThrow(/unavailable.*security/i);
  });

  it("throws when ALL required specialists are unavailable", () => {
    expect(() =>
      routeConsultation("medium", [], ["risk", "compliance"]),
    ).toThrow(/unavailable/i);
  });

  it("succeeds and echoes only available required ids in budget", () => {
    const available = [
      makeSpecialist("risk"),
      makeSpecialist("compliance"),
      makeSpecialist("legal"),
    ];

    const plan = routeConsultation("high", available, ["risk", "compliance"]);

    // budget.requiredSpecialists must only contain ids that were actually selected
    expect(plan.budget.requiredSpecialists).toEqual(
      expect.arrayContaining(["risk", "compliance"]),
    );
    expect(plan.budget.requiredSpecialists).toHaveLength(2);

    const selectedIds = plan.specialists.map((s) => s.id);
    expect(selectedIds).toContain("risk");
    expect(selectedIds).toContain("compliance");
  });

  it("works with no required specialists (empty list)", () => {
    const available = [makeSpecialist("s1"), makeSpecialist("s2")];
    expect(() => routeConsultation("low", available, [])).not.toThrow();
  });

  it("works when requiredSpecialists is omitted (default empty)", () => {
    const available = [makeSpecialist("s1")];
    expect(() => routeConsultation("low", available)).not.toThrow();
  });
});
