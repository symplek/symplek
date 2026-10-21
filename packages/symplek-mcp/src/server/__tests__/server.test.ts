/**
 * @module server.test - Smoke tests for Symplek MCP server tool handlers
 * @description Verifies that symplek_debate, symplek_consensus, and symplek_tracked
 * tool handlers return correct output shapes with mocked @symplek/core.
 * @rules @.cursor/rules/patterns/029-file-header-contracts.mdc
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

// ─── Mock @symplek/core ──────────────────────────────────────────────────────────
// Prevents real LLM calls while verifying handler output shape and wiring.
// vi.mock is hoisted to top of file — use vi.hoisted() for variables that the
// factory closure references, so they're initialized before the mock runs.

const { mockRun, mockDebate, mockConsensus, mockTracked, mockOf } = vi.hoisted(
  () => {
    const mockRun = vi.fn();
    const mockDebate = vi.fn(() => ({ run: mockRun }));
    const mockConsensus = vi.fn(() => ({ run: mockRun }));
    const mockTracked = vi.fn(() => ({ run: mockRun }));
    const mockOf = vi.fn(() => ({
      debate: mockDebate,
      consensus: mockConsensus,
      tracked: mockTracked,
    }));
    return { mockRun, mockDebate, mockConsensus, mockTracked, mockOf };
  },
);

vi.mock("@symplek/core", () => ({
  AgentUnit: { of: mockOf },
  createContext: vi.fn(() => ({ timestamp: 1234567890, extensions: {} })),
}));

import { SYMPLEK_MCP_TOOLS } from "../index";
import { consensusTool } from "../tools/consensus.tool";
// Import tools AFTER mock is set up.
import { debateTool, sessionStore } from "../tools/debate.tool";
import { trackedTool } from "../tools/tracked.tool";

// ─── Debate Handler ───────────────────────────────────────────────────────────

describe("symplek_debate handler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStore.clear();
  });

  it("constructs an AgentUnit and calls debate().run()", async () => {
    mockRun.mockResolvedValueOnce({
      value: {
        finalState: "Test synthesis result",
        votes: [
          {
            agentId: "agent-1",
            decision: "approve",
            confidence: 0.9,
            weight: 1,
          },
        ],
        rounds: 2,
        outcome: "consensus",
        contributions: [],
        attempts: 1,
        converged: true,
      },
    });

    const result = await debateTool.execute({
      prompt: "Should we adopt TypeScript?",
      roles: [
        { role: "Architect", model: "claude-3-opus" },
        { role: "Developer", model: "gpt-4" },
      ],
      rounds: 2,
    });

    expect(mockOf).toHaveBeenCalledWith("Should we adopt TypeScript?");
    expect(mockDebate).toHaveBeenCalledWith(
      expect.arrayContaining([expect.any(Function), expect.any(Function)]),
      expect.objectContaining({ maxRounds: 2 }),
    );
    expect(mockRun).toHaveBeenCalledOnce();

    expect(result).toEqual({
      synthesis: "Test synthesis result",
      votes: expect.any(Array),
      rounds_completed: 2,
    });
  });

  it("returns cached result when session_id already exists", async () => {
    // Pre-populate the session store.
    sessionStore.set("sess-abc", {
      synthesis: "Cached synthesis",
      votes: [],
      rounds_completed: 1,
      created_at: Date.now(),
    });

    const result = await debateTool.execute({
      prompt: "New prompt",
      roles: [{ role: "Architect", model: "claude-3" }],
      session_id: "sess-abc",
    });

    // Should return cached without calling AgentUnit.
    expect(mockOf).not.toHaveBeenCalled();
    expect(result.synthesis).toBe("Cached synthesis");
  });

  it("caches result when session_id is provided on first call", async () => {
    mockRun.mockResolvedValueOnce({
      value: {
        finalState: "Cached on first call",
        votes: [],
        rounds: 1,
        outcome: "consensus",
        contributions: [],
        attempts: 1,
        converged: true,
      },
    });

    await debateTool.execute({
      prompt: "Cache me",
      roles: [{ role: "Reviewer", model: "gpt-4" }],
      session_id: "new-session",
    });

    expect(sessionStore.has("new-session")).toBe(true);
    expect(sessionStore.get("new-session")?.synthesis).toBe(
      "Cached on first call",
    );
  });

  // N52 regression guard: agents must be fixture stubs (no LLM calls).
  // If someone wires real LLM-backed agents, result.result will diverge from
  // the input and this test will fail — the correct signal to update the description.
  it("fixture agents return input unchanged with hasMore:false (N52 regression guard)", async () => {
    type AgentContribution = {
      result: string;
      hasMore: boolean;
      reasoning?: string;
    };
    type FixtureAgent = (
      current: string,
      round: number,
    ) => AgentContribution | Promise<AgentContribution>;

    let capturedAgents: FixtureAgent[] = [];
    mockDebate.mockImplementationOnce(
      (agents: FixtureAgent[], _opts: unknown) => {
        capturedAgents = agents;
        return { run: mockRun };
      },
    );
    mockRun.mockResolvedValueOnce({
      value: {
        finalState: "test prompt",
        votes: [],
        rounds: 1,
        outcome: "consensus",
        contributions: [],
        attempts: 1,
        converged: true,
      },
    });

    await debateTool.execute({
      prompt: "test prompt",
      roles: [{ role: "Critic", model: "gpt-4" }],
    });

    expect(capturedAgents).toHaveLength(1);
    const contribution = await capturedAgents[0]("test prompt", 0);
    expect(contribution.result).toBe("test prompt"); // no transformation applied
    expect(contribution.hasMore).toBe(false);         // single-shot fixture
    // reasoning must disclose the fixture nature (guards against misleading label regressions)
    expect(contribution.reasoning).toContain("fixture");
  });
});

// ─── Consensus Handler ────────────────────────────────────────────────────────

describe("symplek_consensus handler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns { approved, approvalScore, votes } from consensus result", async () => {
    mockRun.mockResolvedValueOnce({
      value: {
        approved: true,
        weightedApproval: 0.85,
        votes: [
          {
            agentId: "voter-0",
            decision: "approve",
            confidence: 0.8,
            weight: 1,
          },
          {
            agentId: "voter-1",
            decision: "approve",
            confidence: 0.9,
            weight: 1,
          },
        ],
        quorum: 0.6,
        consensus: "reached",
        vetoedBy: undefined,
      },
    });

    const result = await consensusTool.execute({
      prompt: "Approve this architecture decision?",
      voters: ["architect", "lead-dev"],
      threshold: 0.6,
    });

    expect(mockOf).toHaveBeenCalledWith("Approve this architecture decision?");
    expect(mockConsensus).toHaveBeenCalledWith(
      expect.arrayContaining([expect.any(Function), expect.any(Function)]),
      expect.objectContaining({ quorum: 0.6 }),
    );

    expect(result).toEqual({
      approved: true,
      score: 0.85,
      votes: expect.arrayContaining([
        expect.objectContaining({ decision: "approve" }),
      ]),
      vetoed_by: null,
    });
  });

  it("propagates vetoers option to consensus operator", async () => {
    mockRun.mockResolvedValueOnce({
      value: {
        approved: false,
        weightedApproval: 0.0,
        votes: [],
        quorum: 0.5,
        consensus: "vetoed",
        vetoedBy: "security-lead",
      },
    });

    const result = await consensusTool.execute({
      prompt: "Deploy to production?",
      voters: ["dev", "qa"],
      threshold: 0.5,
      vetoers: ["security-lead"],
    });

    expect(mockConsensus).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({ vetoers: ["security-lead"] }),
    );
    expect(result.vetoed_by).toBe("security-lead");
  });
});

// ─── Tracked Handler ──────────────────────────────────────────────────────────

describe("symplek_tracked handler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns { value, sourceChain } with source URI and SHA-256 hash", async () => {
    mockRun.mockResolvedValueOnce({
      value: "The prompt text",
      source: "agent",
      confidence: 0.9,
      sourceChain: ["agent"],
    });

    const result = await trackedTool.execute({
      prompt: "The prompt text",
      source: "file:///path/to/source.ts",
      confidence: 0.9,
    });

    expect(mockOf).toHaveBeenCalledWith("The prompt text");
    expect(mockTracked).toHaveBeenCalledWith(
      expect.objectContaining({ source: "agent", confidence: 0.9 }),
    );

    expect(result.value).toBe("The prompt text");
    expect(result.source).toBe("file:///path/to/source.ts");
    expect(result.confidence).toBe(0.9);
    expect(result.hash).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(result.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("hash is deterministic for the same prompt and source URI", async () => {
    // N57 fix: hash now covers both prompt and source URI.
    // Same prompt + same source → same hash.
    mockRun
      .mockResolvedValueOnce({
        value: "hello",
        source: "agent",
        confidence: 0.8,
      })
      .mockResolvedValueOnce({
        value: "hello",
        source: "agent",
        confidence: 0.8,
      });

    const [r1, r2] = await Promise.all([
      trackedTool.execute({
        prompt: "hello",
        source: "file://same-source.ts",
        confidence: 0.8,
      }),
      trackedTool.execute({
        prompt: "hello",
        source: "file://same-source.ts",
        confidence: 0.8,
      }),
    ]);

    expect(r1.hash).toBe(r2.hash);
  });

  it("hash differs when source URI differs (N57 source-binding)", async () => {
    // N57 fix: before the fix, only the prompt was hashed, so callers could
    // substitute any source URI without breaking the hash. Now the source URI
    // is bound into the hash — different sources must produce different hashes.
    mockRun
      .mockResolvedValueOnce({ value: "hello", source: "agent", confidence: 0.8 })
      .mockResolvedValueOnce({ value: "hello", source: "agent", confidence: 0.8 });

    const [r1, r2] = await Promise.all([
      trackedTool.execute({ prompt: "hello", source: "file://a.ts", confidence: 0.8 }),
      trackedTool.execute({ prompt: "hello", source: "file://b.ts", confidence: 0.8 }),
    ]);

    expect(r1.hash).not.toBe(r2.hash);
  });
});

// ─── Tool Registry ────────────────────────────────────────────────────────────

describe("SYMPLEK_MCP_TOOLS registry", () => {
  it("contains all three tools with correct names", () => {
    const names = SYMPLEK_MCP_TOOLS.map((t) => t.name);
    expect(names).toContain("symplek_debate");
    expect(names).toContain("symplek_consensus");
    expect(names).toContain("symplek_tracked");
    expect(names).toHaveLength(3);
  });

  it("every tool has a non-empty description and inputSchema", () => {
    for (const tool of SYMPLEK_MCP_TOOLS) {
      expect(tool.description.length).toBeGreaterThan(10);
      expect(tool.inputSchema.required.length).toBeGreaterThan(0);
    }
  });

  // N52 regression guard: the debate tool description must disclose that agents
  // are fixtures.  If this fails, the description went back to claiming real analysis.
  it("debate tool description discloses fixture / simulation nature (N52)", () => {
    const tool = SYMPLEK_MCP_TOOLS.find((t) => t.name === "symplek_debate");
    expect(tool).toBeDefined();
    expect(tool!.description.toLowerCase()).toMatch(/fixture|simul|stub/);
  });
});
