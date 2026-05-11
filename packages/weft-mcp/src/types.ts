/**
 * @fileoverview MCP type definitions for @weft/mcp package
 * @description Trust-aware tool consumption types mirroring the canonical
 *   definitions in convex/lib/agent_framework/algebra/core/types/mcp.types.ts.
 *   Kept local to avoid cross-boundary imports from packages/ into convex/.
 * @module @weft/mcp/types
 * @since 0.1.0
 */

// ---------------------------------------------------------------------------
// Transport & Connection
// ---------------------------------------------------------------------------

export type MCPTransport = "stdio" | "http" | "sse";
export type MCPConnectionStatus = "active" | "inactive" | "degraded" | "error";
export type MCPAuthMode = "none" | "header" | "oauth" | "apiKeyRef";

// ---------------------------------------------------------------------------
// Policy Verdicts
// ---------------------------------------------------------------------------

export type MCPPolicyVerdict = "allow" | "deny" | "degrade" | "quarantine";

// ---------------------------------------------------------------------------
// Provenance Chain
// ---------------------------------------------------------------------------

export interface ProvenanceLink {
  source: string;
  method: string;
  timestamp: number;
}

export interface MCPFallbackStep {
  serverId: string;
  toolName: string;
  reason: string;
  timestamp: number;
}

export interface CorroborationRef {
  sourceId: string;
  sourceType: string;
  agreement: number;
}

// ---------------------------------------------------------------------------
// Evidence
// ---------------------------------------------------------------------------

/**
 * MCP-sourced evidence wrapper with full provenance metadata.
 * Extends the conceptual TrackedResult pattern from @weft/core with
 * MCP-specific fields (server, tool, transport, freshness, corroboration).
 */
export interface MCPEvidence<T = unknown> {
  value: T;
  source: "mcp";
  confidence: number;
  mcp: {
    serverId: string;
    toolName: string;
    toolVersion?: string;
    transport: MCPTransport;
    fetchedAt: number;
    freshnessScore: number;
    policyVerdict: MCPPolicyVerdict;
    inputHash: string;
    outputHash: string;
    provenanceChain: ProvenanceLink[];
    fallbackChain: MCPFallbackStep[];
    corroboratedBy: CorroborationRef[];
  };
}

// ---------------------------------------------------------------------------
// Tool Configuration
// ---------------------------------------------------------------------------

export interface MCPToolConfig<TInput = unknown> {
  server: string;
  tool: string;
  input: TInput;
  trust?: "none" | "require-tracking" | "require-attestation";
  retry?: number;
  timeout?: number;
}

export interface MCPCallResult<T = unknown> {
  value: T;
  serverId: string;
  toolName: string;
  toolVersion?: string;
  transport: MCPTransport;
  fetchedAt: number;
  durationMs: number;
  inputHash: string;
  outputHash: string;
}

// ---------------------------------------------------------------------------
// Trust Policy
// ---------------------------------------------------------------------------

/**
 * A named policy that evaluates MCP evidence and returns a verdict.
 * Policies are composable — multiple policies can be chained via the
 * trust registry.
 */
export interface MCPTrustPolicy {
  name: string;
  evaluate: (evidence: MCPEvidence<unknown>) => MCPPolicyVerdict;
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export interface MCPServerRegistration {
  serverId: string;
  transport: MCPTransport;
  auth: MCPAuthMode;
  status: MCPConnectionStatus;
  attestedAt?: number;
  attestedBy?: string;
}
