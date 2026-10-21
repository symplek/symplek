import { describe, expect, it } from "vitest";
import type { ExecutionStep, StoredExecution } from "../services/persistence";

describe("@symplek/devtools smoke", () => {
  it("StoredExecution shape matches expected contract", () => {
    const execution: StoredExecution = {
      executionId: "exec-001",
      workflowName: "test-workflow",
      startTime: Date.now(),
      status: "running",
      metrics: { duration: 0 },
      stepCount: 0,
    };
    expect(execution.executionId).toBe("exec-001");
    expect(execution.status).toBe("running");
  });

  it("ExecutionStep extends ExecutionStepPayload with id field", () => {
    const step: ExecutionStep = {
      id: "step-001",
      executionId: "exec-001",
      stepId: "step-001",
      agentName: "test-agent",
      type: "start",
      timestamp: Date.now(),
    };
    expect(step.id).toBe("step-001");
    expect(step.agentName).toBe("test-agent");
  });
});
