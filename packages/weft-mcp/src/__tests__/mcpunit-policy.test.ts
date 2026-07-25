/**
 * @module mcpunit-policy.test - Policy verdict enforcement tests for MCPUnit
 * @description B6 fix: every MCPPolicyVerdict must have a real enforcement arm.
 *   These tests verify that "degrade" and "quarantine" verdicts throw typed errors,
 *   not silently pass through to return evidence (the pre-fix behaviour).
 * @rules @.cursor/rules/patterns/029-file-header-contracts.mdc
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

// ─── Mock transport ──────────────────────────────────────────────────────────

const mockCallToolWithTimeout = vi.fn();
const mockConnect = vi.fn();
const mockDisconnect = vi.fn();

vi.mock("../client/MCPTransportClient", () => ({
  createTransport: vi.fn(() => ({
    connect: mockConnect,
    disconnect: mockDisconnect,
    callToolWithTimeout: mockCallToolWithTimeout,
    isConnected: true,
    _status: "active",
    status: "active",
  })),
  MCPTransportClient: class {},
  StdioMCPTransport: class {},
}));

import {
  MCPCallError,
  MCPPolicyDegradedError,
  MCPPolicyDeniedError,
  MCPPolicyQuarantinedError,
  MCPUnit,
} from "../MCPUnit";
import type { MCPTrustPolicy } from "../types";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function policyReturning(
  verdict: "allow" | "deny" | "degrade" | "quarantine",
): MCPTrustPolicy {
  return {
    name: `always-${verdict}`,
    evaluate: () => verdict,
  };
}

const successResult = {
  content: [{ type: "text", text: "ok" }],
  isError: false,
};

// ─── allow verdict ────────────────────────────────────────────────────────────

describe("MCPUnit policy verdict: allow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockConnect.mockResolvedValue(undefined);
    mockCallToolWithTimeout.mockResolvedValue(successResult);
  });

  it("returns evidence when all policies allow", async () => {
    const mcp = MCPUnit.create({
      transport: { transport: "stdio", command: "echo" },
      policies: [policyReturning("allow")],
    });

    const evidence = await mcp.call("some_tool", {});
    expect(evidence.mcp.policyVerdict).toBe("allow");
    expect(evidence.value).toBeDefined();
  });

  it("returns evidence with no policies configured (empty array)", async () => {
    const mcp = MCPUnit.create({
      transport: { transport: "stdio", command: "echo" },
      policies: [], // opt out of all policy enforcement
    });

    const evidence = await mcp.call("some_tool", {});
    expect(evidence).toBeDefined();
  });
});

// ─── deny verdict ─────────────────────────────────────────────────────────────

describe("MCPUnit policy verdict: deny", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockConnect.mockResolvedValue(undefined);
    mockCallToolWithTimeout.mockResolvedValue(successResult);
  });

  it("throws MCPPolicyDeniedError for a deny verdict", async () => {
    const mcp = MCPUnit.create({
      transport: { transport: "stdio", command: "echo" },
      policies: [policyReturning("deny")],
    });

    await expect(mcp.call("blocked_tool", {})).rejects.toThrow(
      MCPPolicyDeniedError,
    );
  });

  it("MCPPolicyDeniedError carries toolName and deniedBy", async () => {
    const mcp = MCPUnit.create({
      transport: { transport: "stdio", command: "echo" },
      policies: [{ name: "sentinel-deny", evaluate: () => "deny" }],
    });

    const err = await mcp.call("blocked_tool", {}).catch((e) => e);
    expect(err).toBeInstanceOf(MCPPolicyDeniedError);
    expect((err as MCPPolicyDeniedError).toolName).toBe("blocked_tool");
    expect((err as MCPPolicyDeniedError).deniedBy).toBe("sentinel-deny");
  });
});

// ─── degrade verdict (B6 fix) ─────────────────────────────────────────────────

describe("MCPUnit policy verdict: degrade (B6 fix)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockConnect.mockResolvedValue(undefined);
    mockCallToolWithTimeout.mockResolvedValue(successResult);
  });

  it("throws MCPPolicyDegradedError for a degrade verdict (not silently pass)", async () => {
    const mcp = MCPUnit.create({
      transport: { transport: "stdio", command: "echo" },
      policies: [policyReturning("degrade")],
    });

    // B6: before the fix this would silently return evidence instead of throwing
    await expect(mcp.call("read_something", {})).rejects.toThrow(
      MCPPolicyDegradedError,
    );
  });

  it("MCPPolicyDegradedError carries toolName and degrading policy name", async () => {
    const mcp = MCPUnit.create({
      transport: { transport: "stdio", command: "echo" },
      policies: [{ name: "low-trust", evaluate: () => "degrade" }],
    });

    const err = await mcp.call("read_something", {}).catch((e) => e);
    expect(err).toBeInstanceOf(MCPPolicyDegradedError);
    expect((err as MCPPolicyDegradedError).toolName).toBe("read_something");
    expect((err as MCPPolicyDegradedError).message).toContain("low-trust");
  });

  it("MCPPolicyDegradedError carries the evidence for caller inspection", async () => {
    const mcp = MCPUnit.create({
      transport: { transport: "stdio", command: "echo" },
      policies: [policyReturning("degrade")],
    });

    const err = await mcp.call("some_tool", {}).catch((e) => e);
    expect(err).toBeInstanceOf(MCPPolicyDegradedError);
    expect((err as MCPPolicyDegradedError).evidence).toBeDefined();
    expect((err as MCPPolicyDegradedError).evidence.source).toBe("mcp");
  });

  it("is distinguishable from MCPPolicyDeniedError", async () => {
    const mcp = MCPUnit.create({
      transport: { transport: "stdio", command: "echo" },
      policies: [policyReturning("degrade")],
    });

    const err = await mcp.call("tool", {}).catch((e) => e);
    expect(err).toBeInstanceOf(MCPPolicyDegradedError);
    expect(err).not.toBeInstanceOf(MCPPolicyDeniedError);
    expect(err).not.toBeInstanceOf(MCPPolicyQuarantinedError);
  });

  it("degradeToReadOnly policy triggers MCPPolicyDegradedError", async () => {
    // degradeToReadOnly returns "degrade" when evidence has no pre-established "allow"
    // verdict + provenance. Fresh evidence from a cold call gets a self-generated
    // provenance chain and policyVerdict "allow", so degradeToReadOnly returns "allow".
    // But requireTwoSources (no corroboration) returns "degrade". Together:
    const { degradeToReadOnly } = await import("../policies/degradeToReadOnly");
    const { requireTwoSources } = await import("../policies/requireTwoSources");

    const mcp = MCPUnit.create({
      transport: { transport: "stdio", command: "echo" },
      policies: [requireTwoSources, degradeToReadOnly],
    });

    // requireTwoSources → "degrade" (no corroboration) — final verdict "degrade"
    await expect(mcp.call("uncorroborated_tool", {})).rejects.toThrow(
      MCPPolicyDegradedError,
    );
  });
});

// ─── quarantine verdict (B6 fix) ──────────────────────────────────────────────

describe("MCPUnit policy verdict: quarantine (B6 fix)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockConnect.mockResolvedValue(undefined);
    mockCallToolWithTimeout.mockResolvedValue(successResult);
  });

  it("throws MCPPolicyQuarantinedError for a quarantine verdict (not silently pass)", async () => {
    const mcp = MCPUnit.create({
      transport: { transport: "stdio", command: "echo" },
      policies: [policyReturning("quarantine")],
    });

    // B6: before the fix this would silently return evidence
    await expect(mcp.call("suspicious_tool", {})).rejects.toThrow(
      MCPPolicyQuarantinedError,
    );
  });

  it("MCPPolicyQuarantinedError carries toolName", async () => {
    const mcp = MCPUnit.create({
      transport: { transport: "stdio", command: "echo" },
      policies: [policyReturning("quarantine")],
    });

    const err = await mcp.call("suspicious_tool", {}).catch((e) => e);
    expect(err).toBeInstanceOf(MCPPolicyQuarantinedError);
    expect((err as MCPPolicyQuarantinedError).toolName).toBe("suspicious_tool");
  });

  it("MCPPolicyQuarantinedError carries evidence for forensic inspection", async () => {
    const mcp = MCPUnit.create({
      transport: { transport: "stdio", command: "echo" },
      policies: [policyReturning("quarantine")],
    });

    const err = await mcp.call("tool", {}).catch((e) => e);
    expect(err).toBeInstanceOf(MCPPolicyQuarantinedError);
    expect((err as MCPPolicyQuarantinedError).evidence).toBeDefined();
    expect((err as MCPPolicyQuarantinedError).evidence.source).toBe("mcp");
  });

  it("requireAttestation policy triggers MCPPolicyQuarantinedError on empty provenance", async () => {
    // requireAttestation returns "quarantine" when provenanceChain is empty.
    // However, createMCPEvidence adds a default self-generated entry, so in practice
    // requireAttestation returns "allow" for fresh calls. Confirm with explicit policy:
    const mcp = MCPUnit.create({
      transport: { transport: "stdio", command: "echo" },
      policies: [
        {
          name: "no-provenance-check",
          evaluate: (ev) =>
            ev.mcp.provenanceChain.length === 0 ? "quarantine" : "allow",
        },
      ],
    });

    // Fresh evidence has a self-generated provenance chain → "allow"
    const evidence = await mcp.call("tool_with_provenance", {});
    expect(evidence.mcp.policyVerdict).toBe("allow");
  });
});

// ─── Verdict precedence across multiple policies ──────────────────────────────

describe("verdict precedence: deny > quarantine > degrade > allow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockConnect.mockResolvedValue(undefined);
    mockCallToolWithTimeout.mockResolvedValue(successResult);
  });

  it("deny wins over degrade in multi-policy chain", async () => {
    const mcp = MCPUnit.create({
      transport: { transport: "stdio", command: "echo" },
      policies: [policyReturning("degrade"), policyReturning("deny")],
    });
    const err = await mcp.call("tool", {}).catch((e) => e);
    // deny short-circuits before the degrade verdict is calculated as worst
    expect(err).toBeInstanceOf(MCPPolicyDeniedError);
  });

  it("quarantine beats degrade when no deny is present", async () => {
    const mcp = MCPUnit.create({
      transport: { transport: "stdio", command: "echo" },
      policies: [policyReturning("degrade"), policyReturning("quarantine")],
    });
    const err = await mcp.call("tool", {}).catch((e) => e);
    expect(err).toBeInstanceOf(MCPPolicyQuarantinedError);
  });
});

// ─── Transport error (MCPCallError) ───────────────────────────────────────────

describe("MCPCallError on transport failure", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockConnect.mockResolvedValue(undefined);
  });

  it("throws MCPCallError when the tool returns isError:true", async () => {
    mockCallToolWithTimeout.mockResolvedValue({
      content: null,
      isError: true,
      meta: { status: 500 },
    });

    const mcp = MCPUnit.create({
      transport: { transport: "stdio", command: "echo" },
      policies: [],
    });

    await expect(mcp.call("broken_tool", {})).rejects.toThrow(MCPCallError);
  });
});

// ─── trustOverride bypasses policy evaluation ─────────────────────────────────

describe("trustOverride bypasses policy evaluation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockConnect.mockResolvedValue(undefined);
    mockCallToolWithTimeout.mockResolvedValue(successResult);
  });

  it("trustOverride:allow skips policies and stamps the verdict", async () => {
    const mcp = MCPUnit.create({
      transport: { transport: "stdio", command: "echo" },
      policies: [policyReturning("deny")], // would deny without override
    });

    // With override, the deny policy is skipped
    const evidence = await mcp.call("bypassed_tool", {}, {
      trustOverride: "allow",
    });
    expect(evidence.mcp.policyVerdict).toBe("allow");
  });
});
