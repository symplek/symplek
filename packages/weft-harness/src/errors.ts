/**
 * @module HarnessErrors - Typed error classes for harness deviation and contract violations
 * @description HarnessDeviationError, ContractViolationError, and LowProvenanceError.
 * @rules @.cursor/rules/patterns/029-file-header-contracts.mdc
 */

export class HarnessDeviationError extends Error {
  constructor(
    message: string,
    public readonly toolName: string,
    public readonly reason: "unauthorized_tool" | "unauthorized_path",
    public readonly planId: string,
  ) {
    super(message);
    this.name = "HarnessDeviationError";
  }
}

export class ContractViolationError extends Error {
  constructor(
    message: string,
    public readonly planId: string,
    public readonly schemaDescription: string,
    public readonly actualShape: string,
  ) {
    super(message);
    this.name = "ContractViolationError";
  }
}

export class LowProvenanceError extends Error {
  constructor(
    message: string,
    public readonly threshold: number,
    public readonly actual: number,
    public readonly sourceCount: number,
  ) {
    super(message);
    this.name = "LowProvenanceError";
  }
}
