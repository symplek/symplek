/**
 * @module no-legacy-warning.test
 *
 * The legacy trust mode prints a deprecation warning. Coordination operators
 * used that mode internally to run the units they are handed, so a user who
 * passed an AgentUnit voter, and never asked for legacy mode, got the warning
 * anyway. These tests run the operators with unit-returning agents and check
 * that nothing is warned.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentUnit, createContext } from "../index";

let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  AgentUnit.resetDeprecationWarningForTesting();
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  warn.mockRestore();
  AgentUnit.resetDeprecationWarningForTesting();
});

describe("operators given AgentUnit agents", () => {
  it("consensus runs unit voters without a deprecation warning", async () => {
    const voter = () =>
      AgentUnit.of({ decision: "approve" as const, confidence: 0.9 });

    const result = await AgentUnit.of("proposal")
      .consensus([voter, voter], { quorum: 0.5 })
      .run(createContext());

    expect(result.value.approved).toBe(true);
    expect(result.value.votes).toHaveLength(2);
    expect(warn).not.toHaveBeenCalled();
  });

  it("converge runs unit agents without a deprecation warning, and reads their value", async () => {
    const agent = (current: string) =>
      AgentUnit.of({ result: `${current}!`, hasMore: false });

    const result = await AgentUnit.of("draft")
      .converge([agent, agent])
      .run(createContext());

    // The contribution's value is used: a wrapped result here would make the
    // final state an object, not the string the agents produced.
    expect(typeof result.value.finalResult).toBe("string");
    expect(result.value.finalResult).toContain("draft");
    expect(warn).not.toHaveBeenCalled();
  });

  it("debate runs unit agents without a deprecation warning, and reads their value", async () => {
    const agent = (current: string) =>
      AgentUnit.of({ result: current, hasMore: false });

    const result = await AgentUnit.of("proposal")
      .debate([agent, agent], { maxRounds: 2 })
      .run(createContext());

    expect(result.value.finalState).toBe("proposal");
    expect(warn).not.toHaveBeenCalled();
  });

  it("the warning still fires for a caller who does choose legacy mode", async () => {
    await AgentUnit.of("x").run(createContext(), { trustMode: "legacy" });

    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain("deprecated");
  });
});
