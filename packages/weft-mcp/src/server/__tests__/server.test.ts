/**
 * @module server.test - Smoke tests for Weft MCP server tool handlers
 * @description Verifies that weft_debate, weft_consensus, and weft_tracked
 * tool handlers return correct output shapes with mocked @weft/core.
 * @rules @.cursor/rules/patterns/029-file-header-contracts.mdc
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

// ─── Mock @weft/core ──────────────────────────────────────────────────────────
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

vi.mock("@weft/core", () => ({
  AgentUnit: { of: mockOf },
  createContext: vi.fn(() => ({ timestamp: 1234567890, extensions: {} })),
}));

import { WEFT_MCP_TOOLS } from "../index";
import { consensusTool } from "../tools/consensus.tool";
// Import tools AFTER mock is set up.
import { debateTool, sessionStore } from "../tools/debate.tool";
import { trackedTool } from "../tools/tracked.tool";

// ─── Debate Handler ───────────────────────────────────────────────────────────

describe("weft_debate handler", () => {
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
});

// ─── Consensus Handler ────────────────────────────────────────────────────────

describe("weft_consensus handler", () => {
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

describe("weft_tracked handler", () => {
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

  it("hash is deterministic for the same prompt", async () => {
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
        source: "file://a.ts",
        confidence: 0.8,
      }),
      trackedTool.execute({
        prompt: "hello",
        source: "file://b.ts",
        confidence: 0.8,
      }),
    ]);

    expect(r1.hash).toBe(r2.hash);
  });
});

// ─── Tool Registry ────────────────────────────────────────────────────────────

describe("WEFT_MCP_TOOLS registry", () => {
  it("contains all three tools with correct names", () => {
    const names = WEFT_MCP_TOOLS.map((t) => t.name);
    expect(names).toContain("weft_debate");
    expect(names).toContain("weft_consensus");
    expect(names).toContain("weft_tracked");
    expect(names).toHaveLength(3);
  });

  it("every tool has a non-empty description and inputSchema", () => {
    for (const tool of WEFT_MCP_TOOLS) {
      expect(tool.description.length).toBeGreaterThan(10);
      expect(tool.inputSchema.required.length).toBeGreaterThan(0);
    }
  });
});
