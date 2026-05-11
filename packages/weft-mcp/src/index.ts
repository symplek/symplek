/**
 * @fileoverview weft-mcp — MCP Fabric for trust-aware tool consumption
 * @module weft-mcp
 * @since 0.1.0
 *
 * Provides trust-policy-driven MCP server consumption with provenance
 * tracking, attestation, and evidence corroboration.
 *
 * Canonical type definitions live in:
 *   convex/lib/agent_framework/algebra/core/types/mcp.types.ts
 * This package re-exports compatible local definitions to avoid
 * cross-boundary imports from packages/ into convex/.
 */

// ---------------------------------------------------------------------------
// Types (re-exported for consumers)
// ---------------------------------------------------------------------------

export type {
  CorroborationRef,
  MCPAuthMode,
  MCPCallResult,
  MCPConnectionStatus,
  MCPEvidence,
  MCPFallbackStep,
  MCPPolicyVerdict,
  MCPServerRegistration,
  MCPToolConfig,
  MCPTransport,
  MCPTrustPolicy,
  ProvenanceLink,
} from "./types";

// ---------------------------------------------------------------------------
// Evidence
// ---------------------------------------------------------------------------

export type {
  CreateMCPEvidenceOptions,
  MCPEvidenceData,
} from "./evidence/MCPEvidence";
export {
  computeFreshnessScore,
  computeHash,
  createMCPEvidence,
  isCorroborated,
  isEvidenceFresh,
  isMCPEvidence,
  MCP_TRACKED_MARKER,
} from "./evidence/MCPEvidence";

// ---------------------------------------------------------------------------
// Policies
// ---------------------------------------------------------------------------

export type { PolicyEvaluationResult } from "./policies";
export {
  allowTrustedOnly,
  createDefaultPolicyEngine,
  degradeToReadOnly,
  requireAttestation,
  requireTwoSources,
  TrustPolicyEngine,
} from "./policies";

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

export type {
  MCPRegistryConfig,
  MCPServerEntry,
} from "./client/MCPRegistry";
export { MCPRegistry } from "./client/MCPRegistry";
export type {
  MCPCallOptions,
  MCPRawResult,
  MCPToolDescriptor,
  MCPTransportConfig,
} from "./client/MCPTransportClient";
export {
  createTransport,
  HttpMCPTransport,
  MCPTransportClient,
  StdioMCPTransport,
} from "./client/MCPTransportClient";

// ---------------------------------------------------------------------------
// MCPUnit (STORY-04.05)
// ---------------------------------------------------------------------------

export type { MCPUnitConfig } from "./MCPUnit";
export { MCPCallError, MCPPolicyDeniedError, MCPUnit } from "./MCPUnit";

// ---------------------------------------------------------------------------
// Version
// ---------------------------------------------------------------------------

export const VERSION = "0.1.0";
