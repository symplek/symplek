import { describe, expect, it } from "vitest";
import { DEFAULT_LOOP_OPTIONS, type StepInfo, stopWhen } from "../loop";

describe("Loop Control", () => {
  describe("stopWhen helpers", () => {
    it("maxSteps should stop when stepNumber >= n", () => {
      const condition = stopWhen.maxSteps(3);
      const step1: StepInfo = { stepNumber: 1, messages: [], toolResults: [] };
      const step2: StepInfo = { stepNumber: 2, messages: [], toolResults: [] };
      const step3: StepInfo = { stepNumber: 3, messages: [], toolResults: [] };
      const step4: StepInfo = { stepNumber: 4, messages: [], toolResults: [] };

      expect(condition(step1)).toBe(false);
      expect(condition(step2)).toBe(false);
      expect(condition(step3)).toBe(true);
      expect(condition(step4)).toBe(true);
    });

    it("noToolCalls should stop when toolResults is empty", () => {
      const condition = stopWhen.noToolCalls();
      const stepWithTools: StepInfo = {
        stepNumber: 1,
        messages: [],
        toolResults: [{ id: "1" }],
      };
      const stepNoTools: StepInfo = {
        stepNumber: 1,
        messages: [],
        toolResults: [],
      };

      expect(condition(stepWithTools)).toBe(false);
      expect(condition(stepNoTools)).toBe(true);
    });

    it("containsText should stop when lastResponse contains text", () => {
      const condition = stopWhen.containsText("DONE");
      const step1: StepInfo = {
        stepNumber: 1,
        messages: [],
        toolResults: [],
        lastResponse: "Processing...",
      };
      const step2: StepInfo = {
        stepNumber: 2,
        messages: [],
        toolResults: [],
        lastResponse: "All DONE now.",
      };
      const step3: StepInfo = { stepNumber: 3, messages: [], toolResults: [] }; // undefined lastResponse

      expect(condition(step1)).toBe(false);
      expect(condition(step2)).toBe(true);
      expect(condition(step3)).toBe(false);
    });

    it("custom should return the provided function", () => {
      const fn = (step: StepInfo) => step.stepNumber === 42;
      const condition = stopWhen.custom(fn);
      expect(condition).toBe(fn);
    });
  });

  describe("DEFAULT_LOOP_OPTIONS", () => {
    it("should have maxSteps set to 5", () => {
      expect(DEFAULT_LOOP_OPTIONS.maxSteps).toBe(5);
    });
  });
});
