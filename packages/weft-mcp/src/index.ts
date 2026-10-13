/**
 * @fileoverview weft-mcp — MCP server binary and trust-evidence client for Weft
 * @module weft-mcp
 * @since 0.1.0
 *
 * Two surfaces:
 *   1. Server binary (dist/bin.cjs) — exposes weft_debate, weft_consensus, and
 *      weft_tracked as MCP tools over stdio JSON-RPC 2.0.
 *   2. Client library (dist/index.*) — MCPUnit wraps MCP tool calls with
 *      evidence objects and evaluates them against trust policies.
 *
 * The default trust policies (allowTrustedOnly, requireAttestation,
 * degradeToReadOnly) check structural fields that the client itself generates.
 * They provide shape guarantees, not external attestation. To enforce real
 * server-identity checks, supply a custom policy that reads your own registry.
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
// N44/N47: HttpMCPTransport removed — it spoke private REST routes incompatible
// with spec-compliant MCP servers. Use @modelcontextprotocol/sdk SSEClientTransport
// for HTTP/SSE, or switch to the stdio transport.
export {
  createTransport,
  MCPTransportClient,
  StdioMCPTransport,
} from "./client/MCPTransportClient";

// ---------------------------------------------------------------------------
// MCPUnit
// ---------------------------------------------------------------------------

export type { MCPUnitConfig } from "./MCPUnit";
export {
  MCPCallError,
  MCPPolicyDegradedError,
  MCPPolicyDeniedError,
  MCPPolicyQuarantinedError,
  MCPUnit,
} from "./MCPUnit";

// ---------------------------------------------------------------------------
// Version
// ---------------------------------------------------------------------------

export { VERSION } from "./version";
