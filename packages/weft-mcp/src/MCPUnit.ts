/**
 * @fileoverview MCPUnit — factory for MCP tool calls with evidence wrapping and policy evaluation
 * @module weft-mcp
 * @since 0.1.0
 *
 * Level 3 API: Full control over transport, policies, and execution.
 *
 * Usage:
 *   const mcp = MCPUnit.create({ transport: { transport: "stdio", command: "node", args: ["./dist/bin.cjs"] } });
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
   * Stable identifier for this server, used in evidence provenance chains.
   *
   * When omitted, the identity is derived from `transport.endpoint` (for
   * HTTP/SSE) or `transport.command + args` (for stdio). With stdio, every
   * server started with `node` would otherwise share the identity `"node"`.
   * Provide an explicit `serverId` when you run more than one stdio server.
   */
  serverId?: string;
  /**
   * Trust policies to evaluate on every tool call.
   *
   * **What default policies actually check today:**
   * - `allowTrustedOnly`: checks that the client-generated `policyVerdict`
   *   field is "allow" and that the provenance chain is non-empty. Both
   *   conditions are always true for a freshly created evidence object.
   * - `requireAttestation`: checks that the provenance chain is non-empty.
   *   Always true for a fresh call.
   * - `degradeToReadOnly`: same two checks; always returns "allow" for a fresh
   *   call.
   *
   * These policies run **after** the tool has already executed — a "deny"
   * stops evidence from being returned but cannot undo a side effect.
   *
   * None of the defaults consult an external registry or verify the server
   * identity. They provide structural shape guarantees on the evidence object,
   * not attestation. To add real enforcement, supply a custom policy that reads
   * your own registry or trust store.
   *
   * - `undefined` (default): the three built-in policies above. Every fresh
   *   call passes them.
   * - `MCPTrustPolicy[]`: explicit policy list. Use `[]` to opt out of all
   *   policy evaluation (trust-everything mode, suitable for tests and
   *   well-known internal tools).
   */
  policies?: MCPTrustPolicy[];
  /** Default per-call timeout in ms (falls back to transport-level default). */
  defaultTimeout?: number;
  /** Default retry count (reserved for future retry operator). */
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
    // Safe default: when callers omit `policies` entirely, pre-load the three
    // built-in trust policies that a fresh call can satisfy. Callers who want
    // trust-everything must pass an explicit empty array (`policies: []`) —
    // making that choice visible in code and at code review time.
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

    // M12 fix: derive a meaningful server identity when serverId is not explicit.
    // Using only `command` (e.g. "node") gave every stdio server the same
    // identity, making provenance chains indistinguishable.
    const derivedServerId =
      this._config.serverId ??
      this._config.transport.endpoint ??
      (this._config.transport.command
        ? [
            this._config.transport.command,
            ...(this._config.transport.args ?? []),
          ].join(" ")
        : "unknown");

    const evidence = createMCPEvidence<T>({
      value: result.content as T,
      serverId: derivedServerId,
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

      // B6 fix: every verdict must have a real enforcement arm. Previously only
      // "deny" threw; "degrade" and "quarantine" fell through to `return evidence`,
      // making them decorative. Now each non-allow verdict throws a typed error that
      // callers can catch and handle according to their risk tolerance.
      if (evaluation.finalVerdict === "deny") {
        throw new MCPPolicyDeniedError(
          toolName,
          evaluation.deniedBy ?? "unknown",
          evidence as MCPEvidenceData<unknown>,
        );
      }
      if (evaluation.finalVerdict === "quarantine") {
        throw new MCPPolicyQuarantinedError(
          toolName,
          evidence as MCPEvidenceData<unknown>,
        );
      }
      if (evaluation.finalVerdict === "degrade") {
        throw new MCPPolicyDegradedError(
          toolName,
          evaluation.policyResults,
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
    // Include what the server said, so callers do not have to dig through
    // `.meta` to learn why the call failed.
    const text = serverErrorText(meta);
    super(
      `MCP tool call failed: ${toolName}${text === undefined ? "" : `: ${text}`}`,
    );
  }
}

/**
 * The text a server sent with a failed call, if it sent any. A JSON-RPC error
 * carries it as `message`. A tool-level error (`isError`) carries it as a text
 * item in the result's `content` array.
 */
function serverErrorText(
  meta: Record<string, unknown> | undefined,
): string | undefined {
  if (typeof meta?.message === "string") return meta.message;
  if (!Array.isArray(meta?.content)) return undefined;
  for (const item of meta.content) {
    if (
      item !== null &&
      typeof item === "object" &&
      "text" in item &&
      typeof item.text === "string"
    ) {
      return item.text;
    }
  }
  return undefined;
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

/**
 * Thrown when a policy returns "quarantine" — the tool executed but the result
 * must not be used. Callers may inspect `evidence` for diagnostic purposes only.
 */
export class MCPPolicyQuarantinedError extends Error {
  public readonly name = "MCPPolicyQuarantinedError";

  constructor(
    public readonly toolName: string,
    public readonly evidence: MCPEvidenceData<unknown>,
  ) {
    super(
      `MCP tool "${toolName}" result quarantined — origin could not be verified`,
    );
  }
}

/**
 * Thrown when a policy returns "degrade" — the tool executed but the result
 * is restricted (e.g. read-only access only). Callers that explicitly handle
 * degraded results may catch this error and inspect `evidence`.
 */
export class MCPPolicyDegradedError extends Error {
  public readonly name = "MCPPolicyDegradedError";

  constructor(
    public readonly toolName: string,
    public readonly policyResults: Array<{
      policy: string;
      verdict: import("./types").MCPPolicyVerdict;
    }>,
    public readonly evidence: MCPEvidenceData<unknown>,
  ) {
    const degraders = policyResults
      .filter((r) => r.verdict === "degrade")
      .map((r) => r.policy)
      .join(", ");
    super(
      `MCP tool "${toolName}" degraded by ${degraders || "policy"} — result restricted to read-only access`,
    );
  }
}
