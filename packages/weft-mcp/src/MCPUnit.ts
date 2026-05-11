/**
 * @fileoverview MCPUnit — factory for creating MCP-aware AgentUnit computations
 * @module weft-mcp
 * @since 0.1.0
 *
 * 📝 BUILD[F-068/04.05]: MCPUnit factory wrapping transport + evidence + policies
 *
 * Level 3 API: Full control over transport, policies, and execution.
 * MCPUnit is a factory around AgentUnit (NOT a second monad).
 *
 * Usage:
 *   const mcp = MCPUnit.create({ transport: { transport: "http", endpoint: "..." } });
 *   const result = await mcp.call("toolName", { input: "data" });
 */

import {
  createTransport,
  type MCPCallOptions,
  type MCPTransportClient,
  type MCPTransportConfig,
} from "./client/MCPTransportClient";
import {
  createMCPEvidence,
  type MCPEvidenceData,
} from "./evidence/MCPEvidence";
import {
  createDefaultPolicyEngine,
  TrustPolicyEngine,
} from "./policies/TrustPolicyEngine";
import type { MCPPolicyVerdict, MCPTrustPolicy } from "./types";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export interface MCPUnitConfig {
  transport: MCPTransportConfig;
  /**
   * Trust policies to evaluate on every tool call.
   *
   * - `undefined` (default): safe defaults — `createDefaultPolicyEngine()`
   *   pre-loads `allowTrustedOnly`, `requireAttestation`, `requireTwoSources`,
   *   `degradeToReadOnly`. Recommended for production.
   * - `MCPTrustPolicy[]`: explicit policy list (use `[]` to opt out of all
   *   policy enforcement — every call returns `allow`. This is an explicit
   *   trust-everything mode, intended for tests and trusted internal tools).
   */
  policies?: MCPTrustPolicy[];
  /** Default per-call timeout in ms (falls back to transport-level default). */
  defaultTimeout?: number;
  /** Default retry count (reserved for Story 04.06 retry operator). */
  defaultRetry?: number;
}

// ---------------------------------------------------------------------------
// MCPUnit
// ---------------------------------------------------------------------------

export class MCPUnit {
  private readonly client: MCPTransportClient;
  private readonly policyEngine: TrustPolicyEngine;
  private readonly _config: MCPUnitConfig;
  private _connected = false;

  private constructor(config: MCPUnitConfig) {
    this._config = config;
    this.client = createTransport(config.transport);
    // Safe default: when callers omit `policies` entirely, pre-load the four
    // built-in trust policies. Callers who want trust-everything must pass
    // an explicit empty array (`policies: []`) — making that choice visible
    // in code and at code review time.
    this.policyEngine =
      config.policies === undefined
        ? createDefaultPolicyEngine()
        : new TrustPolicyEngine(config.policies);
  }

  static create(config: MCPUnitConfig): MCPUnit {
    return new MCPUnit(config);
  }

  // ---- lifecycle -----------------------------------------------------------

  async connect(): Promise<void> {
    if (!this._connected) {
      await this.client.connect();
      this._connected = true;
    }
  }

  async disconnect(): Promise<void> {
    if (this._connected) {
      await this.client.disconnect();
      this._connected = false;
    }
  }

  get isConnected(): boolean {
    return this._connected;
  }

  // ---- tool execution ------------------------------------------------------

  /**
   * Call an MCP tool with evidence wrapping and policy evaluation.
   *
   * Flow: connect → transport call → evidence wrap → policy evaluate → return.
   * Throws {@link MCPCallError} on transport failure,
   * {@link MCPPolicyDeniedError} when a policy returns "deny".
   *
   * @param trustOverride — skip policy evaluation and stamp this verdict directly.
   */
  async call<T = unknown>(
    toolName: string,
    input: unknown,
    options?: MCPCallOptions & { trustOverride?: MCPPolicyVerdict },
  ): Promise<MCPEvidenceData<T>> {
    await this.connect();

    const result = await this.client.callToolWithTimeout(toolName, input, {
      timeout: options?.timeout ?? this._config.defaultTimeout,
      signal: options?.signal,
    });

    if (result.isError) {
      throw new MCPCallError(toolName, result.meta);
    }

    const evidence = createMCPEvidence<T>({
      value: result.content as T,
      serverId:
        this._config.transport.endpoint ??
        this._config.transport.command ??
        "unknown",
      toolName,
      transport: this._config.transport.transport,
      input,
      confidence: 0.7,
    });

    if (options?.trustOverride) {
      evidence.mcp.policyVerdict = options.trustOverride;
      return evidence;
    }

    if (this.policyEngine.policyCount > 0) {
      const evaluation = this.policyEngine.evaluate(
        evidence as MCPEvidenceData<unknown>,
      );
      evidence.mcp.policyVerdict = evaluation.finalVerdict;

      if (evaluation.finalVerdict === "deny") {
        throw new MCPPolicyDeniedError(
          toolName,
          evaluation.deniedBy ?? "unknown",
          evidence as MCPEvidenceData<unknown>,
        );
      }
    }

    return evidence;
  }

  // ---- discovery -----------------------------------------------------------

  async listTools(): Promise<string[]> {
    await this.connect();
    const tools = await this.client.listTools();
    return tools.map((t) => t.name);
  }
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class MCPCallError extends Error {
  public readonly name = "MCPCallError";

  constructor(
    public readonly toolName: string,
    public readonly meta?: Record<string, unknown>,
  ) {
    super(`MCP tool call failed: ${toolName}`);
  }
}

export class MCPPolicyDeniedError extends Error {
  public readonly name = "MCPPolicyDeniedError";

  constructor(
    public readonly toolName: string,
    public readonly deniedBy: string,
    public readonly evidence: MCPEvidenceData<unknown>,
  ) {
    super(`MCP tool "${toolName}" denied by policy "${deniedBy}"`);
  }
}
