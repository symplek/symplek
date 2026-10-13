/**
 * @fileoverview MCPEvidence<T> — provenance-wrapped MCP tool results
 * @module weft-mcp/evidence
 * @since 0.1.0
 *
 * Wraps MCP tool outputs with trust metadata: integrity hashes,
 * time-decay freshness, policy verdicts, and provenance chains.
 * Carries a Symbol marker for TrackedResult compatibility.
 */

import { createHash } from "node:crypto";

import type {
  CorroborationRef,
  MCPEvidence,
  MCPFallbackStep,
  MCPPolicyVerdict,
  MCPTransport,
  ProvenanceLink,
} from "../types";

// ---------------------------------------------------------------------------
// Symbol marker
// ---------------------------------------------------------------------------

/**
 * TrackedResult-compatible marker for MCP evidence objects.
 * Uses `Symbol.for()` (global registry) so cross-package consumers can
 * test with `MCP_TRACKED_MARKER in value`.
 */
export const MCP_TRACKED_MARKER = Symbol.for("__Weft_tracked_mcp__");

// ---------------------------------------------------------------------------
// Options & data interfaces
// ---------------------------------------------------------------------------

export interface CreateMCPEvidenceOptions<T> {
  value: T;
  serverId: string;
  toolName: string;
  toolVersion?: string;
  transport: MCPTransport;
  /** Raw input sent to the MCP tool — hashed for integrity verification. */
  input: unknown;
  /** Override default confidence (0.7). Must be 0–1. */
  confidence?: number;
  policyVerdict?: MCPPolicyVerdict;
  provenanceChain?: ProvenanceLink[];
  fallbackChain?: MCPFallbackStep[];
  corroboratedBy?: CorroborationRef[];
}

/**
 * Full evidence envelope returned by `createMCPEvidence`.
 * Extends the base MCPEvidence<T> with a sourceChain for
 * multi-hop provenance propagation.
 */
export interface MCPEvidenceData<T> extends MCPEvidence<T> {
  sourceChain: string[];
}

// ---------------------------------------------------------------------------
// Hash & freshness internals
// ---------------------------------------------------------------------------

const FRESHNESS_HALF_LIFE_MS = 5 * 60 * 1000;

/**
 * SHA-256 truncated to 16 hex chars for integrity fingerprinting.
 * Deterministic for the same input (JSON-serialised if non-string).
 */
export function computeHash(data: unknown): string {
  const str = typeof data === "string" ? data : JSON.stringify(data ?? null);
  return createHash("sha256").update(str).digest("hex").slice(0, 16);
}

/**
 * Exponential decay from 1.0 (just fetched) toward 0.
 * Half-life: 5 minutes. Returns 0 for future timestamps.
 */
export function computeFreshnessScore(fetchedAt: number): number {
  const ageMs = Date.now() - fetchedAt;
  if (ageMs <= 0) return 1.0;
  return Math.max(0, Math.exp((-Math.LN2 * ageMs) / FRESHNESS_HALF_LIFE_MS));
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create an MCPEvidence<T> wrapping an MCP tool result with full provenance.
 *
 * Progressive disclosure:
 *   Level 1 — `{ value, serverId, toolName, transport, input }`
 *   Level 2 — + `policyVerdict`, `confidence`, `provenanceChain`
 *   Level 3 — + `fallbackChain`, `corroboratedBy`
 */
export function createMCPEvidence<T>(
  options: CreateMCPEvidenceOptions<T>,
): MCPEvidenceData<T> {
  const now = Date.now();

  const confidence = options.confidence ?? 0.7;
  if (confidence < 0 || confidence > 1 || !Number.isFinite(confidence)) {
    throw new RangeError(
      `confidence must be a finite number between 0 and 1, got ${String(confidence)}`,
    );
  }

  const evidence: MCPEvidenceData<T> & { [key: symbol]: true } = {
    [MCP_TRACKED_MARKER]: true as const,
    value: options.value,
    source: "mcp",
    confidence,
    sourceChain: ["mcp"],
    mcp: {
      serverId: options.serverId,
      toolName: options.toolName,
      toolVersion: options.toolVersion,
      transport: options.transport,
      fetchedAt: now,
      freshnessScore: computeFreshnessScore(now),
      policyVerdict: options.policyVerdict ?? "allow",
      inputHash: computeHash(options.input),
      outputHash: computeHash(options.value),
      provenanceChain: options.provenanceChain ?? [
        {
          source: options.serverId,
          method: `mcp:${options.transport}`,
          timestamp: now,
        },
      ],
      fallbackChain: options.fallbackChain ?? [],
      corroboratedBy: options.corroboratedBy ?? [],
    },
  };

  return evidence;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * True when recomputed freshness is at or above `minFreshness`.
 * Recomputes from `fetchedAt` so the score reflects *current* staleness.
 */
export function isEvidenceFresh<T>(
  evidence: MCPEvidenceData<T>,
  minFreshness = 0.5,
): boolean {
  return computeFreshnessScore(evidence.mcp.fetchedAt) >= minFreshness;
}

/** True when evidence has been corroborated by at least `minSources` refs. */
export function isCorroborated<T>(
  evidence: MCPEvidenceData<T>,
  minSources = 1,
): boolean {
  return evidence.mcp.corroboratedBy.length >= minSources;
}

/**
 * Runtime type guard for MCPEvidence objects.
 * Validates the Symbol marker + structural shape.
 */
export function isMCPEvidence(
  value: unknown,
): value is MCPEvidenceData<unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    MCP_TRACKED_MARKER in (value as Record<symbol, unknown>) &&
    "mcp" in value &&
    "source" in value &&
    (value as { source: string }).source === "mcp"
  );
}

// Re-export base type for consumers importing directly from evidence module
export type { MCPEvidence } from "../types";
