import { describe, expect, it, vi } from "vitest";
import { parallel } from "../parallel";

// Mock the ai function to avoid real API calls
vi.mock("../ai", async (importOriginal) => {
  const original = (await importOriginal()) as any;
  const mockAi = vi.fn(async (prompt: string) => {
    if (prompt.includes("fail")) throw new Error("Mock failure");
    return `Response to: ${prompt}`;
  });

  // Re-attach properties to the mock
  Object.assign(mockAi, original.ai);

  return {
    ai: mockAi,
  };
});

describe("Parallel Execution (ai.all)", () => {
  it("should execute multiple prompts in parallel", async () => {
    const prompts = ["Prompt 1", "Prompt 2", "Prompt 3"];
    const results = await parallel(prompts);

    expect(results).toHaveLength(3);
    expect(results[0]).toBe("Response to: Prompt 1");
    expect(results[1]).toBe("Response to: Prompt 2");
    expect(results[2]).toBe("Response to: Prompt 3");
  });

  it("should handle AIPrompt objects with options", async () => {
    const requests = [
      { prompt: "Prompt 1", options: { quality: "fast" as const } },
      { prompt: "Prompt 2", options: { quality: "high" as const } },
    ];
    const results = await parallel(requests);

    expect(results).toHaveLength(2);
    expect(results[0]).toBe("Response to: Prompt 1");
    expect(results[1]).toBe("Response to: Prompt 2");
  });

  it("should fail fast by default if one task fails", async () => {
    const prompts = ["Prompt 1", "fail", "Prompt 3"];
    await expect(parallel(prompts)).rejects.toThrow("Mock failure");
  });

  it("should not fail fast if failFast is set to false", async () => {
    const prompts = ["Prompt 1", "fail", "Prompt 3"];
    const results = await parallel(prompts, { failFast: false });

    expect(results).toHaveLength(3);
    expect(results[0]).toBe("Response to: Prompt 1");
    expect(results[1]).toBeUndefined();
    expect(results[2]).toBe("Response to: Prompt 3");
  });
});

// consensus.ts tests removed — see FIX-GUARD[FP-CONSENSUS-ZOMBIE-DELETED-20260313]
// The standalone consensus module had incompatible Vote/ConsensusResult types vs
// the canonical types.ts used by AgentUnit operators. Use AgentUnit.consensus() instead.
