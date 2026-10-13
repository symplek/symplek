/**
 * @module server.test - Smoke tests for Weft MCP server tool handlers
 * @description Verifies that weft_debate, weft_consensus, and weft_tracked
 * tool handlers return correct output shapes with mocked weft-core.
 * @rules @.cursor/rules/patterns/029-file-header-contracts.mdc
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

// ─── Mock weft-core ──────────────────────────────────────────────────────────
// Prevents real LLM calls while verifying handler output shape and wiring.
// vi.mock is hoisted to top of file — use vi.hoisted() for variables that the
// factory closure references, so they're initialized before the mock runs.

const { mockRun, mockDebate, mockConsensus, mockOf } = vi.hoisted(
  () => {
    const mockRun = vi.fn();
    const mockDebate = vi.fn(() => ({ run: mockRun }));
    const mockConsensus = vi.fn(() => ({ run: mockRun }));
    // mockTracked kept in closure so AgentUnit.of().tracked is available on the mock,
    // but is not exported — tracked.tool.ts no longer calls AgentUnit.of().tracked().
    const mockTracked = vi.fn(() => ({ run: mockRun }));
    const mockOf = vi.fn(() => ({
      debate: mockDebate,
      consensus: mockConsensus,
      tracked: mockTracked,
    }));
    return { mockRun, mockDebate, mockConsensus, mockOf };
  },
);

vi.mock("weft-core", () => ({
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
      simulated: true,
      notice: expect.stringContaining("No debate took place"),
      synthesis: "Test synthesis result",
      votes: expect.any(Array),
      rounds_completed: 2,
    });
  });

  it("returns cached result when session_id and prompt match", async () => {
    // M8 fix: the cache is keyed by session_id AND prompt. Pre-populate with
    // the same prompt that will be used in the call.
    sessionStore.set("sess-abc", {
      simulated: true,
      notice: "fixture",
      synthesis: "Cached synthesis",
      votes: [],
      rounds_completed: 1,
      created_at: Date.now(),
      prompt: "Same prompt",
      roles: [{ role: "Architect", model: "claude-3" }],
      rounds: undefined,
    });

    const result = await debateTool.execute({
      prompt: "Same prompt",
      roles: [{ role: "Architect", model: "claude-3" }],
      session_id: "sess-abc",
    });

    // Should return cached without calling AgentUnit.
    expect(mockOf).not.toHaveBeenCalled();
    expect(result.synthesis).toBe("Cached synthesis");
  });

  it("does NOT return cached result when session_id matches but prompt differs (M8 fix)", async () => {
    // M8 fix: a reused session_id with a different prompt is a new debate.
    // The old code returned the stale synthesis from the first prompt.
    mockRun.mockResolvedValueOnce({
      value: {
        finalState: "New prompt synthesis",
        votes: [],
        rounds: 1,
        outcome: "consensus",
        contributions: [],
        attempts: 1,
        converged: true,
      },
    });

    // Pre-populate with the FIRST prompt's result.
    sessionStore.set("sess-mismatch", {
      simulated: true,
      notice: "fixture",
      synthesis: "First prompt synthesis",
      votes: [],
      rounds_completed: 1,
      created_at: Date.now(),
      prompt: "First prompt",
      roles: [{ role: "Reviewer", model: "gpt-4" }],
      rounds: undefined,
    });

    const result = await debateTool.execute({
      prompt: "Different prompt",
      roles: [{ role: "Reviewer", model: "gpt-4" }],
      session_id: "sess-mismatch",
    });

    // Must NOT return the cached "First prompt synthesis".
    expect(result.synthesis).not.toBe("First prompt synthesis");
    // Must compute a new result for the new prompt.
    expect(mockOf).toHaveBeenCalledWith("Different prompt");
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
    // M8 fix: the prompt must be stored in the cache entry.
    expect(sessionStore.get("new-session")?.prompt).toBe("Cache me");
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

    // A stub approval must not be readable as a decision: the result itself
    // says no evaluation took place.
    expect(result).toEqual({
      simulated: true,
      notice: expect.stringContaining("No evaluation took place"),
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
// Note: weft_tracked no longer uses weft-core (AgentUnit). It computes the
// hash and records the caller's claims directly. Tests assert the output
// contract without mocking weft-core.

describe("weft_tracked handler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns value, source, confidence, sha256 hash, timestamp, and notice", async () => {
    const result = await trackedTool.execute({
      prompt: "The prompt text",
      source: "file:///path/to/source.ts",
      confidence: 0.9,
    });

    // The tool must not call weft-core (no side-effect on the mock).
    expect(mockOf).not.toHaveBeenCalled();

    expect(result.value).toBe("The prompt text");
    expect(result.source).toBe("file:///path/to/source.ts");
    expect(result.confidence).toBe(0.9);
    expect(result.hash).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(result.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    // M7 fix: result must carry a notice that source/confidence are unverified.
    expect(result.notice).toBeTruthy();
    expect(result.notice.toLowerCase()).toMatch(/claim|assert|verif/);
  });

  it("hash is deterministic for the same prompt and source URI", async () => {
    // Same prompt + same source → same hash.
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

  it("hash differs when source URI differs (M7 collision fix)", async () => {
    // M7 fix: before, prompt 'a|b' + source 'c' collided with prompt 'a' +
    // source 'b|c'. Now JSON.stringify([prompt, source]) is used, which is
    // unambiguous.
    const [r1, r2] = await Promise.all([
      trackedTool.execute({ prompt: "a|b", source: "c", confidence: 0.8 }),
      trackedTool.execute({ prompt: "a", source: "b|c", confidence: 0.8 }),
    ]);

    expect(r1.hash).not.toBe(r2.hash);
  });

  it("hash differs when prompt differs (different sources)", async () => {
    const [r1, r2] = await Promise.all([
      trackedTool.execute({ prompt: "hello", source: "file://a.ts", confidence: 0.8 }),
      trackedTool.execute({ prompt: "hello", source: "file://b.ts", confidence: 0.8 }),
    ]);

    expect(r1.hash).not.toBe(r2.hash);
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

  // N52 regression guard: the debate tool description must disclose that agents
  // are fixtures.  If this fails, the description went back to claiming real analysis.
  it("debate tool description discloses fixture / simulation nature (N52)", () => {
    const tool = WEFT_MCP_TOOLS.find((t) => t.name === "weft_debate");
    expect(tool).toBeDefined();
    expect(tool!.description.toLowerCase()).toMatch(/fixture|simul|stub/);
  });

  // Schema correctness: rounds must be standard JSON Schema type "integer", not
  // the non-standard { type:"number", integer:true } form. A client that reads
  // "number" sends 1.5 and is refused at runtime; the schema and the validation
  // must agree on what is legal.
  it("debate tool rounds field uses standard type:integer schema (not number+integer:true)", () => {
    const tool = WEFT_MCP_TOOLS.find((t) => t.name === "weft_debate");
    expect(tool).toBeDefined();
    const roundsSchema = (
      tool!.inputSchema.properties as Record<string, Record<string, unknown>>
    ).rounds;
    expect(roundsSchema).toBeDefined();
    expect(roundsSchema.type).toBe("integer");
    // The non-standard key must not be present.
    expect(roundsSchema).not.toHaveProperty("integer");
  });
});

// ─── Debate cache: roles and rounds are part of the key ───────────────────────

describe("weft_debate cache key includes roles and rounds", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStore.clear();
  });

  it("does NOT return cached result when roles differ (cache-key fix)", async () => {
    mockRun.mockResolvedValue({
      value: {
        finalState: "synthesis",
        votes: [],
        rounds: 2,
        outcome: "consensus",
        contributions: [],
        attempts: 1,
        converged: true,
      },
    });

    // Prime cache with role set A.
    sessionStore.set("sess-roles", {
      simulated: true,
      notice: "fixture",
      synthesis: "cached for role-A",
      votes: [],
      rounds_completed: 2,
      created_at: Date.now(),
      prompt: "Same prompt",
      roles: [{ role: "Architect", model: "m1" }],
      rounds: undefined,
    });

    // Call with the same session_id and prompt but a different role set.
    const result = await debateTool.execute({
      prompt: "Same prompt",
      roles: [{ role: "Developer", model: "m2" }],
      session_id: "sess-roles",
    });

    // Must NOT serve the stale "cached for role-A" synthesis.
    expect(result.synthesis).not.toBe("cached for role-A");
    // Must have gone through AgentUnit for the new roles.
    expect(mockOf).toHaveBeenCalledWith("Same prompt");
  });

  it("does NOT return cached result when rounds differ (cache-key fix)", async () => {
    mockRun.mockResolvedValue({
      value: {
        finalState: "synthesis for 4 rounds",
        votes: [],
        rounds: 4,
        outcome: "consensus",
        contributions: [],
        attempts: 1,
        converged: true,
      },
    });

    // Prime cache with rounds:2.
    sessionStore.set("sess-rounds", {
      simulated: true,
      notice: "fixture",
      synthesis: "cached for 2 rounds",
      votes: [],
      rounds_completed: 2,
      created_at: Date.now(),
      prompt: "Same prompt",
      roles: [{ role: "Architect", model: "m1" }],
      rounds: 2,
    });

    // Same session_id, same prompt, same roles — but rounds changed to 4.
    const result = await debateTool.execute({
      prompt: "Same prompt",
      roles: [{ role: "Architect", model: "m1" }],
      rounds: 4,
      session_id: "sess-rounds",
    });

    expect(result.synthesis).not.toBe("cached for 2 rounds");
    expect(mockOf).toHaveBeenCalledWith("Same prompt");
  });

  it("returns cached result when prompt, roles, and rounds all match", async () => {
    sessionStore.set("sess-full-match", {
      simulated: true,
      notice: "fixture",
      synthesis: "cached full match",
      votes: [],
      rounds_completed: 3,
      created_at: Date.now(),
      prompt: "Same prompt",
      roles: [{ role: "Architect", model: "m1" }],
      rounds: 3,
    });

    const result = await debateTool.execute({
      prompt: "Same prompt",
      roles: [{ role: "Architect", model: "m1" }],
      rounds: 3,
      session_id: "sess-full-match",
    });

    // Must return cached result without calling AgentUnit.
    expect(mockOf).not.toHaveBeenCalled();
    expect(result.synthesis).toBe("cached full match");
  });
});
