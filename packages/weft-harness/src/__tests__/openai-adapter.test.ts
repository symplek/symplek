/**
 * @module OpenAIAdapterTests - Smoke tests for the openai-agents Harness adapter
 * @description Verifies that createHarness({ adapter: "openai-agents" }) wires the correct
 * interface without requiring @openai/agents to be installed. All assertions are
 * structural — no real API calls are made.
 * @rules @.cursor/rules/patterns/029-file-header-contracts.mdc
 */

import { describe, expect, it } from "vitest";
import { AgentUnit } from "weft-core";
import { createHarness } from "../adapter/claude-agent-sdk";

describe("openai-agents adapter", () => {
  it("createHarness returns an object with plan, execute, and session methods", () => {
    const harness = createHarness({
      adapter: "openai-agents",
      tools: ["Read"],
    });

    expect(typeof harness.plan).toBe("function");
    expect(typeof harness.execute).toBe("function");
    expect(typeof harness.session).toBe("function");
  });

  it("harness.plan() returns an AgentUnit without throwing", () => {
    const harness = createHarness({
      adapter: "openai-agents",
      tools: ["Read"],
    });

    const unit = harness.plan("test plan intent", {});

    expect(unit).toBeInstanceOf(AgentUnit);
  });

  it("adapter does not throw on construction when @openai/agents is not installed", () => {
    expect(() =>
      createHarness({ adapter: "openai-agents", tools: ["Read", "Grep"] }),
    ).not.toThrow();
  });

  it("harness.plan() AgentUnit resolves to a TrackedResult with a plan artifact", async () => {
    const { createContext } = await import("weft-core");
    const harness = createHarness({
      adapter: "openai-agents",
      tools: ["Read", "Grep"],
    });

    // createContext takes no positional id — use zero-arg form.
    const ctx = createContext();
    const unit = harness.plan("check openai adapter wiring", {
      tools: ["Read"],
    });

    // AgentUnit.run() wraps the computation result in an outer TrackedResult.
    // The computation itself returns TrackedResult<PlanArtifact>, so the full
    // shape is TrackedResult<TrackedResult<PlanArtifact>>:
    //   result         → outer TrackedResult (from AgentUnit.run)
    //   result.value   → inner TrackedResult<PlanArtifact> (from makePlanUnit)
    //   result.value.value → PlanArtifact
    const result = await unit.run(ctx);
    const inner = result.value; // TrackedResult<PlanArtifact>
    const artifact = inner.value; // PlanArtifact

    expect(artifact).toBeDefined();
    expect(typeof artifact.id).toBe("string");
    expect(artifact.id).toHaveLength(64); // SHA-256 hex
    expect(artifact.intent).toBe("check openai adapter wiring");
    expect(Array.isArray(artifact.steps)).toBe(true);
  });

  it("harness.execute() returns an AgentUnit without throwing", () => {
    const harness = createHarness({
      adapter: "openai-agents",
      tools: ["Read"],
    });

    const mockVerified = {
      plan: {
        id: "abc123",
        intent: "test",
        steps: [],
        requiredTools: ["Read"],
        estimatedImpact: "P1" as const,
        sources: [],
      },
      votes: [],
      approvalScore: 0.9,
    };

    expect(() => harness.execute(mockVerified)).not.toThrow();
    const unit = harness.execute(mockVerified);
    expect(unit).toBeInstanceOf(AgentUnit);
  });

  it("harness.session() returns an AgentUnit without throwing", () => {
    const harness = createHarness({
      adapter: "openai-agents",
      tools: ["Read"],
    });

    expect(() => harness.session("test prompt")).not.toThrow();
    const unit = harness.session("test prompt");
    expect(unit).toBeInstanceOf(AgentUnit);
  });
});
