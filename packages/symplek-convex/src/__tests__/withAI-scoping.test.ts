/**
 * @module withAI-scoping.test — Compiler/runtime enforcement of withAI scope context (Item 6)
 * @description Verifies that withAI() throws at construction time when middleware is
 *   enabled without the required scope context, preventing cross-user data misattribution.
 *   FIX-GUARD[FP-LOGACTIVITY-SCOPE-20260303] / FIX-GUARD[FP-TRACKCOST-SCOPE-20260303].
 *
 *   A failure here means the enforcement regressed, not that the test is wrong.
 *
 * @rules @.cursor/rules/patterns/029-file-header-contracts.mdc
 */

import { describe, expect, it } from "vitest";
import { withAI } from "../withAI";

const stubCtx = { runMutation: async () => {} } as any;
const logActivityRef = "internal.ai.logActivity" as any;
const trackCostRef = "internal.ai.trackCost" as any;

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("Item 6 — withAI() scope context enforcement", () => {
  it("throws when logActivity mutation is provided without activityContext", () => {
    expect(() =>
      withAI(stubCtx, {
        mutations: { logActivity: logActivityRef },
        // activityContext intentionally omitted
      }),
    ).toThrow("[withAI] activityContext is required when mutations.logActivity is provided");
  });

  it("throws when trackCost mutation is provided without costContext.userId", () => {
    expect(() =>
      withAI(stubCtx, {
        mutations: { trackCost: trackCostRef },
        // costContext intentionally omitted
      }),
    ).toThrow("[withAI] costContext.userId is required when mutations.trackCost is provided");
  });

  it("throws when trackCost is provided with costContext missing userId", () => {
    expect(() =>
      withAI(stubCtx, {
        mutations: { trackCost: trackCostRef },
        costContext: { projectId: "p1" }, // no userId
      }),
    ).toThrow("[withAI] costContext.userId is required when mutations.trackCost is provided");
  });

  it("does NOT throw when logActivity is provided with activityContext", () => {
    expect(() =>
      withAI(stubCtx, {
        mutations: { logActivity: logActivityRef },
        activityContext: { projectId: "p1", threadId: "t1" },
      }),
    ).not.toThrow();
  });

  it("does NOT throw when trackCost is provided with costContext.userId", () => {
    expect(() =>
      withAI(stubCtx, {
        mutations: { trackCost: trackCostRef },
        costContext: { userId: "u1" },
      }),
    ).not.toThrow();
  });

  it("does NOT throw when no mutations are provided (no context required)", () => {
    expect(() => withAI(stubCtx)).not.toThrow();
    expect(() => withAI(stubCtx, {})).not.toThrow();
    expect(() =>
      withAI(stubCtx, { mutations: { logActivity: undefined, trackCost: undefined } }),
    ).not.toThrow();
  });

  it("does NOT throw when logActivity is undefined even if mutations object is present", () => {
    expect(() =>
      withAI(stubCtx, {
        mutations: { logActivity: undefined },
      }),
    ).not.toThrow();
  });
});
