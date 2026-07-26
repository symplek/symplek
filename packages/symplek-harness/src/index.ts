/**
 * @module SymplekHarness - Public API barrel for @symplek/harness
 * @description Exports all type contracts and error classes. The createHarness factory
 * implementation is provided by adapter modules (W1-B).
 * @rules @.cursor/rules/patterns/029-file-header-contracts.mdc
 */

// W1-B: real createHarness factory backed by the Claude Agent SDK adapter.
export { createHarness } from "./adapter/claude-agent-sdk.js";
// CR-501: AgentUnitHarness — interceptor injection for replay-based CI tests.
export {
  AgentUnitHarness,
  INTERCEPTOR_EXTENSION_KEY,
} from "./agent-unit-harness.js";
export type { ConsensusDefaults } from "./consensus-defaults.js";
export { getConsensusDefaults } from "./consensus-defaults.js";
export {
  ContractViolationError,
  HarnessDeviationError,
  LowProvenanceError,
} from "./errors.js";
export type { SdkEvent, SdkSession } from "./operators/execute.js";
export { execute } from "./operators/execute.js";
export type { PermissionDecision } from "./permission-bridge.js";
export { buildPermissionBridge } from "./permission-bridge.js";
export {
  assertDeterministic,
  DeterminismViolationError,
} from "./replay/assert-deterministic.js";
export type { SessionEndEntry, ToolUseEntry, TraceEntry } from "./replay/index.js";
// W2-B: replay / determinism exports
export {
  isSessionEnd,
  loadTrace,
  parseTrace,
  ReplayAdapter,
  ReplayIncompleteError,
  ReplayMismatchError,
} from "./replay/index.js";
export type {
  ConsensusVote,
  ExecuteOptions,
  Harness,
  HarnessAdapter,
  HarnessConfig,
  HarnessPhase,
  HarnessProgressEvent,
  ImpactTier,
  McpServerConfig,
  PlanArtifact,
  PlanOptions,
  PlanStep,
  PlanUnit,
  SourceRef,
  VerifiedPlan,
} from "./types.js";
