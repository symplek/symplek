import { afterEach, describe, expect, it, vi } from "vitest";

import {
  allowTrustedOnly,
  computeFreshnessScore,
  computeHash,
  createMCPEvidence,
  isCorroborated,
  isEvidenceFresh,
  isMCPEvidence,
  MCPRegistry,
  type MCPTrustPolicy,
  requireTwoSources,
  TrustPolicyEngine,
} from "../index";

describe("@symplek/mcp evidence", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("createMCPEvidence creates valid evidence with all fields", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-18T12:00:00.000Z"));

    const input = { prompt: "summarize" };
    const provenanceChain = [
      {
        source: "trusted-server",
        method: "mcp:http",
        timestamp: Date.now(),
      },
    ];
    const fallbackChain = [
      {
        serverId: "backup-server",
        toolName: "search_backup",
        reason: "primary timeout",
        timestamp: Date.now(),
      },
    ];
    const corroboratedBy = [
      {
        sourceId: "source-1",
        sourceType: "mcp",
        agreement: 0.93,
      },
      {
        sourceId: "source-2",
        sourceType: "web",
        agreement: 0.88,
      },
    ];

    const evidence = createMCPEvidence({
      value: { result: "ok" },
      serverId: "trusted-server",
      toolName: "search",
      toolVersion: "1.2.3",
      transport: "http",
      input,
      confidence: 0.92,
      policyVerdict: "allow",
      provenanceChain,
      fallbackChain,
      corroboratedBy,
    });

    expect(isMCPEvidence(evidence)).toBe(true);
    expect(evidence).toMatchObject({
      value: { result: "ok" },
      source: "mcp",
      confidence: 0.92,
      sourceChain: ["mcp"],
      mcp: {
        serverId: "trusted-server",
        toolName: "search",
        toolVersion: "1.2.3",
        transport: "http",
        fetchedAt: Date.now(),
        freshnessScore: 1,
        policyVerdict: "allow",
        inputHash: computeHash(input),
        outputHash: computeHash({ result: "ok" }),
        provenanceChain,
        fallbackChain,
        corroboratedBy,
      },
    });
  });

  it("computeFreshnessScore decays over time", () => {
    vi.useFakeTimers();
    const now = new Date("2026-03-18T12:00:00.000Z");
    vi.setSystemTime(now);

    const freshScore = computeFreshnessScore(now.getTime());
    const halfLifeScore = computeFreshnessScore(now.getTime() - 5 * 60 * 1000);
    const staleScore = computeFreshnessScore(now.getTime() - 10 * 60 * 1000);

    expect(freshScore).toBe(1);
    expect(halfLifeScore).toBeCloseTo(0.5, 2);
    expect(staleScore).toBeLessThan(halfLifeScore);
  });

  it("isEvidenceFresh returns true for fresh evidence", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-18T12:00:00.000Z"));

    const evidence = createMCPEvidence({
      value: { ok: true },
      serverId: "fresh-server",
      toolName: "lookup",
      transport: "http",
      input: { q: "latest" },
    });

    expect(isEvidenceFresh(evidence)).toBe(true);
  });

  it("isCorroborated checks corroboration count", () => {
    const evidence = createMCPEvidence({
      value: { ok: true },
      serverId: "corroborated-server",
      toolName: "lookup",
      transport: "http",
      input: { q: "facts" },
      corroboratedBy: [
        { sourceId: "a", sourceType: "mcp", agreement: 0.9 },
        { sourceId: "b", sourceType: "web", agreement: 0.85 },
      ],
    });

    expect(isCorroborated(evidence)).toBe(true);
    expect(isCorroborated(evidence, 3)).toBe(false);
  });
});

describe("@symplek/mcp policies", () => {
  it("TrustPolicyEngine chains policies correctly", () => {
    const degradePolicy: MCPTrustPolicy = {
      name: "degradeFirst",
      evaluate: vi.fn(() => "degrade" as const),
    };
    const quarantinePolicy: MCPTrustPolicy = {
      name: "quarantineSecond",
      evaluate: vi.fn(() => "quarantine" as const),
    };
    const engine = new TrustPolicyEngine([degradePolicy, quarantinePolicy]);
    const evidence = createMCPEvidence({
      value: { ok: true },
      serverId: "policy-server",
      toolName: "lookup",
      transport: "http",
      input: { q: "chain" },
    });

    const result = engine.evaluate(evidence);

    expect(result.finalVerdict).toBe("quarantine");
    expect(result.policyResults).toEqual([
      { policy: "degradeFirst", verdict: "degrade" },
      { policy: "quarantineSecond", verdict: "quarantine" },
    ]);
    expect(degradePolicy.evaluate).toHaveBeenCalledOnce();
    expect(quarantinePolicy.evaluate).toHaveBeenCalledOnce();
  });

  it("TrustPolicyEngine short-circuits on deny", () => {
    const denyPolicy: MCPTrustPolicy = {
      name: "denyFirst",
      evaluate: vi.fn(() => "deny" as const),
    };
    const skippedPolicy: MCPTrustPolicy = {
      name: "shouldNotRun",
      evaluate: vi.fn(() => "allow" as const),
    };
    const engine = new TrustPolicyEngine([denyPolicy, skippedPolicy]);
    const evidence = createMCPEvidence({
      value: { ok: true },
      serverId: "policy-server",
      toolName: "lookup",
      transport: "http",
      input: { q: "short-circuit" },
    });

    const result = engine.evaluate(evidence);

    expect(result).toEqual({
      finalVerdict: "deny",
      policyResults: [{ policy: "denyFirst", verdict: "deny" }],
      deniedBy: "denyFirst",
    });
    expect(denyPolicy.evaluate).toHaveBeenCalledOnce();
    expect(skippedPolicy.evaluate).not.toHaveBeenCalled();
  });

  it("allowTrustedOnly policy denies unattested", () => {
    const evidence = createMCPEvidence({
      value: { ok: true },
      serverId: "untrusted-server",
      toolName: "lookup",
      transport: "http",
      input: { q: "attestation" },
      provenanceChain: [],
    });

    expect(allowTrustedOnly.evaluate(evidence)).toBe("deny");
  });

  it("requireTwoSources policy degrades single-source", () => {
    const evidence = createMCPEvidence({
      value: { ok: true },
      serverId: "single-source-server",
      toolName: "lookup",
      transport: "http",
      input: { q: "corroboration" },
      corroboratedBy: [{ sourceId: "a", sourceType: "mcp", agreement: 0.9 }],
    });

    expect(requireTwoSources.evaluate(evidence)).toBe("degrade");
  });
});

describe("@symplek/mcp registry", () => {
  it("MCPRegistry registers and retrieves servers", () => {
    const registry = new MCPRegistry();

    registry.register(
      "server-1",
      "Primary MCP",
      {
        transport: "http",
        endpoint: "https://mcp.example.com",
      },
      {
        attested: true,
        capabilities: ["search", "read"],
      },
    );

    expect(registry.getServer("server-1")).toMatchObject({
      id: "server-1",
      name: "Primary MCP",
      status: "inactive",
      attested: true,
      capabilities: ["search", "read"],
      failureCount: 0,
    });
  });

  it("MCPRegistry tracks failure counts", () => {
    const registry = new MCPRegistry({
      maxFailuresBeforeDegraded: 2,
      maxFailuresBeforeError: 3,
    });

    registry.register("server-1", "Primary MCP", {
      transport: "http",
      endpoint: "https://mcp.example.com",
    });

    registry.recordFailure("server-1", "timeout");
    expect(registry.getServer("server-1")).toMatchObject({
      failureCount: 1,
      status: "inactive",
      lastError: "timeout",
    });

    registry.recordFailure("server-1", "timeout");
    expect(registry.getServer("server-1")).toMatchObject({
      failureCount: 2,
      status: "degraded",
    });

    registry.recordFailure("server-1", "fatal");
    expect(registry.getServer("server-1")).toMatchObject({
      failureCount: 3,
      status: "error",
      lastError: "fatal",
    });
  });
});
