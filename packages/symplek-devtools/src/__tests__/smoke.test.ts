import { describe, expect, it } from "vitest";
import {
  MODEL_COSTS,
  calculateCost,
  formatCost,
  formatNumber,
} from "../panel/utils/costs";

describe("calculateCost()", () => {
  it("calculates gpt-4o cost correctly at 1000 input / 1000 output tokens", () => {
    // rates: input $0.005/k, output $0.015/k
    const cost = calculateCost("gpt-4o", 1000, 1000);
    expect(cost).toBeCloseTo(0.005 + 0.015, 6); // $0.020
  });

  it("calculates claude-3-5-sonnet cost correctly at 2000 input / 500 output tokens", () => {
    // rates: input $0.003/k, output $0.015/k
    const cost = calculateCost("claude-3-5-sonnet", 2000, 500);
    expect(cost).toBeCloseTo(2 * 0.003 + 0.5 * 0.015, 6); // $0.0135
  });

  it("calculates gpt-4o-mini cost correctly at 10000 input / 10000 output tokens", () => {
    // rates: input $0.00015/k, output $0.0006/k
    const cost = calculateCost("gpt-4o-mini", 10_000, 10_000);
    expect(cost).toBeCloseTo(10 * 0.00015 + 10 * 0.0006, 6); // $0.0075
  });

  it("falls back to gpt-4o rates for unknown models", () => {
    const unknown = calculateCost("unknown-model-xyz", 1000, 1000);
    const gpt4o = calculateCost("gpt-4o", 1000, 1000);
    expect(unknown).toBeCloseTo(gpt4o, 6);
  });

  it("returns 0 when both token counts are 0", () => {
    expect(calculateCost("gpt-4o", 0, 0)).toBe(0);
  });
});

describe("formatCost()", () => {
  it("formats a cost as a USD currency string", () => {
    const result = formatCost(0.02);
    expect(result).toContain("$");
    expect(result).toContain("0.02");
  });

  it("includes at least 4 decimal places", () => {
    const result = formatCost(0.00001);
    // minimumFractionDigits: 4 — should show at least 4 decimal places
    const parts = result.split(".");
    expect(parts.length).toBe(2);
    expect(parts[1].length).toBeGreaterThanOrEqual(4);
  });

  it("formats zero cost as $0.0000", () => {
    const result = formatCost(0);
    expect(result).toContain("$");
    expect(result).toContain("0.0000");
  });
});

describe("formatNumber()", () => {
  it("formats large integers with thousands separators", () => {
    const result = formatNumber(1_234_567);
    // en-US: 1,234,567
    expect(result).toContain(",");
    expect(result).toMatch(/1[,.]?234[,.]?567/);
  });

  it("formats zero as '0'", () => {
    expect(formatNumber(0)).toBe("0");
  });
});

describe("MODEL_COSTS table", () => {
  it("contains at least three models", () => {
    expect(Object.keys(MODEL_COSTS).length).toBeGreaterThanOrEqual(3);
  });

  it("every entry has numeric input and output rates", () => {
    for (const [model, rates] of Object.entries(MODEL_COSTS)) {
      expect(typeof rates.input, `${model}.input`).toBe("number");
      expect(typeof rates.output, `${model}.output`).toBe("number");
      expect(rates.input, `${model}.input should be positive`).toBeGreaterThan(0);
      expect(rates.output, `${model}.output should be positive`).toBeGreaterThan(0);
    }
  });

  it("gpt-4o is in the table", () => {
    expect("gpt-4o" in MODEL_COSTS).toBe(true);
  });
});
