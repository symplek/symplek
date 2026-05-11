/**
 * @fileoverview Tests for Team and TeamRegistry classes
 * @description Team abstraction and global registry for named agent teams
 *
 * 📝 BUILD[F-048.03.03]: Teams tests
 *
 * @remarks
 * These tests use `trustMode: 'legacy'` to test basic functionality.
 * The Team abstraction provides a reusable configuration for agent groups,
 * while TeamRegistry enables named team access across the application.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createContext, Team, TeamRegistry, teams } from "../index";
import type { TeamConfig } from "../teams/types";
import type {
  AdvisorAgent,
  AgentContext,
  ConvergeContribution,
  Critique,
  LeaderAgent,
  SynthesisResponse,
  ThesisResponse,
} from "../types";

describe("Team", () => {
  let ctx: AgentContext;

  // Suppress deprecation warnings during tests
  let consoleWarnSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    ctx = createContext();
    consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    consoleWarnSpy.mockRestore();
  });

  // Helper to create mock agents for debate mode
  const createDebateAgent = (id: number) =>
    vi.fn(
      (state: string): ConvergeContribution<string> => ({
        result: `${state}-agent${id}`,
        hasMore: false,
        reasoning: `Agent ${id} done`,
      }),
    );

  // Helper to create mock leader for dialectic mode
  const createLeader = (satisfiedAfter = 1): LeaderAgent<string> => {
    let roundCount = 0;
    return {
      propose: vi.fn(
        async (
          input: string,
          _round: number,
        ): Promise<ThesisResponse<string>> => ({
          thesis: `Thesis: ${input}`,
          reasoning: "Leader reasoning",
        }),
      ),
      synthesize: vi.fn(
        async (
          _thesis: string,
          _critiques: Critique[],
        ): Promise<SynthesisResponse<string>> => {
          roundCount++;
          return {
            synthesis: `Synthesis ${roundCount}`,
            satisfied: roundCount >= satisfiedAfter,
            reasoning: "Synthesis reasoning",
          };
        },
      ),
    };
  };

  // Helper to create mock advisor
  const createAdvisor = (): AdvisorAgent<string> =>
    vi.fn(
      async (_thesis: string, round: number): Promise<Critique> => ({
        advisorId: `advisor-${round}`,
        critique: "Minor issue",
        severity: "minor",
        suggestions: ["Suggestion"],
      }),
    );

  describe("create", () => {
    it("should create debate team with agents", () => {
      const agents = [createDebateAgent(1), createDebateAgent(2)];
      const config: TeamConfig<string> = {
        name: "debate-team",
        mode: "debate",
        agents,
      };

      const team = Team.create(config);
      expect(team).toBeDefined();
    });

    it("should create dialectic team with leader and advisors", () => {
      const leader = createLeader();
      const advisors = [createAdvisor()];
      const config: TeamConfig<string> = {
        name: "dialectic-team",
        mode: "dialectic",
        leader,
        advisors,
      };

      const team = Team.create(config);
      expect(team).toBeDefined();
    });

    it("should create converge team with agents", () => {
      const agents = [createDebateAgent(1)];
      const config: TeamConfig<string> = {
        name: "converge-team",
        mode: "converge",
        agents,
      };

      const team = Team.create(config);
      expect(team).toBeDefined();
    });

    it("should throw when dialectic missing leader", () => {
      const config: TeamConfig<string> = {
        name: "bad-team",
        mode: "dialectic",
        // Missing leader
        advisors: [createAdvisor()],
      };

      expect(() => Team.create(config)).toThrow(/leader/i);
    });

    it("should throw when debate missing agents", () => {
      const config: TeamConfig<string> = {
        name: "bad-team",
        mode: "debate",
        // Missing agents
      };

      expect(() => Team.create(config)).toThrow(/agents/i);
    });

    it("should throw when converge missing agents", () => {
      const config: TeamConfig<string> = {
        name: "bad-team",
        mode: "converge",
        // Missing agents
      };

      expect(() => Team.create(config)).toThrow(/agents/i);
    });
  });

  describe("ask", () => {
    it("should return TeamResult with correct team name", async () => {
      const agents = [createDebateAgent(1)];
      const team = Team.create<string>({
        name: "my-team",
        mode: "debate",
        agents,
      });

      const result = await team.ask("input").run(ctx, { trustMode: "legacy" });

      expect(result.team).toBe("my-team");
    });

    it("should include mode-specific result", async () => {
      const agents = [createDebateAgent(1)];
      const team = Team.create<string>({
        name: "debate-team",
        mode: "debate",
        agents,
      });

      const result = await team.ask("input").run(ctx, { trustMode: "legacy" });

      expect(result.mode).toBe("debate");
      expect(result.result).toBeDefined();
    });

    it("should track duration in metadata", async () => {
      const agents = [createDebateAgent(1)];
      const team = Team.create<string>({
        name: "timed-team",
        mode: "debate",
        agents,
      });

      const result = await team.ask("input").run(ctx, { trustMode: "legacy" });

      expect(result.metadata.durationMs).toBeDefined();
      expect(typeof result.metadata.durationMs).toBe("number");
      expect(result.metadata.durationMs).toBeGreaterThanOrEqual(0);
    });
  });

  describe("convenience methods", () => {
    it("consensus() should work for debate mode", async () => {
      const agents = [createDebateAgent(1), createDebateAgent(2)];
      const team = Team.create<string>({
        name: "consensus-team",
        mode: "debate",
        agents,
      });

      const result = await team
        .consensus("input")
        .run(ctx, { trustMode: "legacy" });

      expect(result.outcome).toBeDefined();
    });

    it("consensus() should throw for dialectic mode", () => {
      const team = Team.create<string>({
        name: "dialectic-team",
        mode: "dialectic",
        leader: createLeader(),
        advisors: [createAdvisor()],
      });

      expect(() => team.consensus("input")).toThrow(/debate/i);
    });

    it("solve() should work for dialectic mode", async () => {
      const team = Team.create<string>({
        name: "solve-team",
        mode: "dialectic",
        leader: createLeader(),
        advisors: [createAdvisor()],
      });

      const result = await team
        .solve("problem")
        .run(ctx, { trustMode: "legacy" });

      expect(result.outcome).toBeDefined();
    });

    it("solve() should throw for debate mode", () => {
      const agents = [createDebateAgent(1)];
      const team = Team.create<string>({
        name: "debate-team",
        mode: "debate",
        agents,
      });

      expect(() => team.solve("input")).toThrow(/dialectic/i);
    });

    it("refine() should work for converge mode", async () => {
      const agents = [createDebateAgent(1)];
      const team = Team.create<string>({
        name: "refine-team",
        mode: "converge",
        agents,
      });

      const result = await team
        .refine("input")
        .run(ctx, { trustMode: "legacy" });

      expect(result.converged).toBeDefined();
    });

    it("refine() should throw for dialectic mode", () => {
      const team = Team.create<string>({
        name: "dialectic-team",
        mode: "dialectic",
        leader: createLeader(),
        advisors: [createAdvisor()],
      });

      expect(() => team.refine("input")).toThrow(/converge/i);
    });
  });

  describe("broadcast mode", () => {
    it("should broadcast input to all agents", async () => {
      const agents = [createDebateAgent(1), createDebateAgent(2)];
      const team = Team.create<string>({
        name: "broadcast-team",
        mode: "broadcast",
        agents,
      });

      const result = await team.ask("input").run(ctx, { trustMode: "legacy" });

      expect(result.mode).toBe("broadcast");
      // All agents should have been called
      expect(agents[0]).toHaveBeenCalled();
      expect(agents[1]).toHaveBeenCalled();
    });
  });
});

describe("TeamRegistry", () => {
  let ctx: AgentContext;
  let registry: TeamRegistry;

  // Suppress deprecation warnings during tests
  let consoleWarnSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    ctx = createContext();
    registry = new TeamRegistry();
    consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    consoleWarnSpy.mockRestore();
    registry.clear();
  });

  // Helper to create a simple team
  const createTeam = (name: string) =>
    Team.create<string>({
      name,
      mode: "debate",
      agents: [
        (state: string): ConvergeContribution<string> => ({
          result: `${state}-done`,
          hasMore: false,
        }),
      ],
    });

  describe("register", () => {
    it("should register and retrieve teams", () => {
      const team = createTeam("test-team");
      registry.register(team);

      const retrieved = registry.get<string>("test-team");
      expect(retrieved).toBe(team);
    });

    it("should warn on duplicate registration", () => {
      const team1 = createTeam("dup-team");
      const team2 = createTeam("dup-team");

      registry.register(team1);
      registry.register(team2); // Should warn

      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining("dup-team"),
      );
    });
  });

  describe("get", () => {
    it("should throw when team not found", () => {
      expect(() => registry.get("nonexistent")).toThrow(/not found/i);
    });

    it("should return registered team", () => {
      const team = createTeam("findable");
      registry.register(team);

      const found = registry.get<string>("findable");
      expect(found).toBe(team);
    });
  });

  describe("has", () => {
    it("should return true for registered teams", () => {
      const team = createTeam("exists");
      registry.register(team);

      expect(registry.has("exists")).toBe(true);
    });

    it("should return false for unregistered teams", () => {
      expect(registry.has("doesnt-exist")).toBe(false);
    });
  });

  describe("list", () => {
    it("should list all registered team names", () => {
      registry.register(createTeam("team-a"));
      registry.register(createTeam("team-b"));
      registry.register(createTeam("team-c"));

      const names = registry.list();
      expect(names).toContain("team-a");
      expect(names).toContain("team-b");
      expect(names).toContain("team-c");
      expect(names).toHaveLength(3);
    });

    it("should return empty array when no teams registered", () => {
      expect(registry.list()).toHaveLength(0);
    });
  });

  describe("unregister", () => {
    it("should unregister teams", () => {
      const team = createTeam("removable");
      registry.register(team);
      expect(registry.has("removable")).toBe(true);

      const removed = registry.unregister("removable");
      expect(removed).toBe(true);
      expect(registry.has("removable")).toBe(false);
    });

    it("should return false when team not found", () => {
      const removed = registry.unregister("never-existed");
      expect(removed).toBe(false);
    });
  });

  describe("ask", () => {
    it("should invoke teams via ask shortcut", async () => {
      const team = createTeam("callable");
      registry.register(team);

      const result = await registry
        .ask<string>("callable", "input")
        .run(ctx, { trustMode: "legacy" });

      expect(result.team).toBe("callable");
    });

    it("should throw when team not found", () => {
      expect(() => registry.ask("missing", "input")).toThrow(/not found/i);
    });
  });

  describe("clear", () => {
    it("should remove all registered teams", () => {
      registry.register(createTeam("team-1"));
      registry.register(createTeam("team-2"));
      expect(registry.size).toBe(2);

      registry.clear();
      expect(registry.size).toBe(0);
    });
  });

  describe("size", () => {
    it("should return number of registered teams", () => {
      expect(registry.size).toBe(0);

      registry.register(createTeam("t1"));
      expect(registry.size).toBe(1);

      registry.register(createTeam("t2"));
      expect(registry.size).toBe(2);
    });
  });
});

describe("teams singleton", () => {
  let ctx: AgentContext;

  // Suppress deprecation warnings during tests
  let consoleWarnSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    ctx = createContext();
    teams.clear(); // Reset singleton state
    consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    consoleWarnSpy.mockRestore();
    teams.clear();
  });

  it("should be a global TeamRegistry instance", () => {
    expect(teams).toBeInstanceOf(TeamRegistry);
  });

  it("should persist across imports", () => {
    const team = Team.create<string>({
      name: "global-team",
      mode: "debate",
      agents: [
        (state: string): ConvergeContribution<string> => ({
          result: `${state}!`,
          hasMore: false,
        }),
      ],
    });

    teams.register(team);
    expect(teams.has("global-team")).toBe(true);
  });

  it("should allow global team invocation", async () => {
    const team = Team.create<string>({
      name: "invokable",
      mode: "debate",
      agents: [
        (state: string): ConvergeContribution<string> => ({
          result: state.toUpperCase(),
          hasMore: false,
        }),
      ],
    });

    teams.register(team);

    const result = await teams
      .ask<string>("invokable", "hello")
      .run(ctx, { trustMode: "legacy" });

    expect(result.team).toBe("invokable");
  });
});
