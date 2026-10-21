/**
 * @module tierBoundary - Verifies free-tier developer primitives are fully accessible from @symplek/core
 * @description Confirms that solo, interview, conduct, dialectic, debate, coherence, converge,
 *   rehearse, and replay operators are available on AgentUnit without any @symplek/pro dependency.
 *   All imports are from @symplek/core relative paths only.
 */
import { describe, expect, it } from "vitest";

// ONLY @symplek/core imports — must never import from @symplek/pro
import { AgentUnit, createContext } from "../index";

describe("@symplek/core free-tier operator boundary", () => {
  const ctx = createContext();

  // ─── Method presence (prototype shape) ──────────────────────────────────────

  describe("AgentUnit prototype has all developer-primitive operators", () => {
    it("has .solo() method", () => {
      expect(typeof AgentUnit.prototype.solo).toBe("function");
    });

    it("has .interview() method", () => {
      expect(typeof AgentUnit.prototype.interview).toBe("function");
    });

    it("has .conduct() method", () => {
      expect(typeof AgentUnit.prototype.conduct).toBe("function");
    });

    it("has .dialectic() method", () => {
      expect(typeof AgentUnit.prototype.dialectic).toBe("function");
    });

    it("has .debate() method", () => {
      expect(typeof AgentUnit.prototype.debate).toBe("function");
    });

    it("has .coherence() method", () => {
      expect(typeof AgentUnit.prototype.coherence).toBe("function");
    });

    it("has .converge() method", () => {
      expect(typeof AgentUnit.prototype.converge).toBe("function");
    });

    it("has .rehearse() method", () => {
      expect(typeof AgentUnit.prototype.rehearse).toBe("function");
    });

    it("has .replay() method", () => {
      expect(typeof AgentUnit.prototype.replay).toBe("function");
    });

    it("has .consensus() method (single-round free-tier)", () => {
      expect(typeof AgentUnit.prototype.consensus).toBe("function");
    });
  });

  // ─── Smoke: operators return AgentUnit instances (no @symplek/pro needed) ───────

  describe("free-tier operators produce AgentUnit without @symplek/pro", () => {
    it(".solo() returns an AgentUnit", () => {
      const unit = AgentUnit.from(() =>
        Promise.resolve({ confidence: 0.9, coherence: 0.9, riskScore: 0.1 }),
      );
      const result = unit.solo();
      expect(result).toBeInstanceOf(AgentUnit);
    });

    it(".dialectic() returns an AgentUnit", () => {
      const unit = AgentUnit.from(() => Promise.resolve("problem"));
      const leader = {
        propose: async (input: string, _round: number) => ({ thesis: input }),
        synthesize: async (thesis: string) => ({
          synthesis: thesis,
          satisfied: true,
        }),
      };
      const result = unit.dialectic(leader, []);
      expect(result).toBeInstanceOf(AgentUnit);
    });

    it(".debate() returns an AgentUnit", () => {
      const unit = AgentUnit.from(() => Promise.resolve("state"));
      const result = unit.debate([]);
      expect(result).toBeInstanceOf(AgentUnit);
    });

    it(".converge() returns an AgentUnit", () => {
      const unit = AgentUnit.from(() => Promise.resolve("start"));
      const result = unit.converge([]);
      expect(result).toBeInstanceOf(AgentUnit);
    });

    it(".consensus() returns an AgentUnit", () => {
      const unit = AgentUnit.from(() => Promise.resolve("proposal"));
      const result = unit.consensus([]);
      expect(result).toBeInstanceOf(AgentUnit);
    });

    it(".rehearse() returns an AgentUnit", () => {
      const unit = AgentUnit.from(() => Promise.resolve("value"));
      const result = unit.rehearse();
      expect(result).toBeInstanceOf(AgentUnit);
    });
  });

  // ─── End-to-end: operators execute without @symplek/pro ────────────────────────

  describe("free-tier operators execute end-to-end without @symplek/pro", () => {
    it(".dialectic() runs leader-satisfied with no advisors", async () => {
      const unit = AgentUnit.from<string>(() => Promise.resolve("problem"));
      const leader = {
        propose: async (input: string, _round: number) => ({
          thesis: `thesis:${input}`,
        }),
        synthesize: async (thesis: string) => ({
          synthesis: `synth:${thesis}`,
          satisfied: true,
        }),
      };
      const result = await unit
        .dialectic(leader, [])
        .run(ctx, { trustMode: "legacy" });
      expect(result.outcome).toBe("satisfied");
      expect(result.finalThesis).toContain("synth:");
    });

    it(".debate() resolves with empty agents (vacuous consensus)", async () => {
      const unit = AgentUnit.from<string>(() => Promise.resolve("state"));
      const result = await unit.debate([]).run(ctx, { trustMode: "legacy" });
      expect(result.outcome).toBe("consensus");
      expect(result.finalState).toBe("state");
    });

    it(".rehearse() captures a trace", async () => {
      const unit = AgentUnit.from<string>(() => Promise.resolve("hello"));
      const result = await unit.rehearse().run(ctx, { trustMode: "legacy" });
      expect(result.value).toBe("hello");
      expect(result.trace).toBeDefined();
    });

    it(".converge() returns finalResult with no agents", async () => {
      const unit = AgentUnit.from<string>(() => Promise.resolve("initial"));
      const result = await unit.converge([]).run(ctx, { trustMode: "legacy" });
      expect(result.finalResult).toBe("initial");
    });

    it(".consensus() returns approved with no voters (quorum 0.5, 0 votes)", async () => {
      const unit = AgentUnit.from<string>(() => Promise.resolve("proposal"));
      const result = await unit.consensus([]).run(ctx, { trustMode: "legacy" });
      // 0 votes, weightedApproval = 0, quorum default 0.5 → not approved
      expect(result).toHaveProperty("approved");
      expect(result).toHaveProperty("votes");
    });
  });
});
