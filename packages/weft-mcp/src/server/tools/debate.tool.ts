/**
 * @module DebateTool - MCP tool definition for the Weft debate operator
 * @description Wires weft_debate MCP calls to AgentUnit.debate() operator.
 * Simulated role agents run converge+consensus in a single call; optional
 * session_id caches the result in process-memory for multi-turn access.
 * @rules @.cursor/rules/patterns/029-file-header-contracts.mdc
 */

import { AgentUnit, createContext } from "@weft/core";
import type { DebateAgent } from "../weft-core-ops";

// ─── Session Store ────────────────────────────────────────────────────────────
// Keyed by session_id. State is in-process only — not durable across restarts.
// See DESIGN-NOTES.md for trade-offs and production guidance.

interface DebateSessionEntry {
  synthesis: string;
  votes: unknown[];
  rounds_completed: number;
  created_at: number;
}

export const sessionStore = new Map<string, DebateSessionEntry>();

// ─── Tool Definition ──────────────────────────────────────────────────────────

export const debateTool = {
  name: "weft_debate",
  description:
    "Run a structured multi-agent debate. Multiple specialist agents review a prompt from their role perspectives, then a synthesizer produces a final synthesis. Returns the synthesis and all votes.",
  inputSchema: {
    type: "object" as const,
    properties: {
      prompt: {
        type: "string",
        description: "The question or proposal to debate",
      },
      roles: {
        type: "array",
        items: {
          type: "object",
          properties: {
            role: { type: "string" },
            model: { type: "string" },
          },
          required: ["role", "model"],
        },
        description: "Specialist roles that will debate the prompt",
      },
      rounds: {
        type: "number",
        description: "Number of debate rounds (default: 2)",
      },
      session_id: {
        type: "string",
        description:
          "Optional: reuse an ongoing debate session across multiple calls. When provided, results are cached in process-memory and returned on subsequent calls with the same session_id.",
      },
    },
    required: ["prompt", "roles"],
  },
  execute: async (input: {
    prompt: string;
    roles: Array<{ role: string; model: string }>;
    rounds?: number;
    session_id?: string;
  }): Promise<{
    synthesis: string;
    votes: unknown[];
    rounds_completed: number;
  }> => {
    // Return cached result when session already exists.
    if (input.session_id) {
      const cached = sessionStore.get(input.session_id);
      if (cached) {
        const { created_at: _ts, ...rest } = cached;
        return rest;
      }
    }

    // Build simulated DebateAgents — one per role.
    // Each agent signals hasMore: false after one round (single-shot per call).
    const agents: Array<DebateAgent<string>> = input.roles.map(
      (r) => (current: string, _round: number) => ({
        result: current,
        hasMore: false,
        reasoning: `${r.role} perspective applied to: ${current.slice(0, 60)}`,
      }),
    );

    const ctx = createContext();
    const result = await AgentUnit.of(input.prompt)
      .debate(agents, { maxRounds: input.rounds ?? 2 })
      .run(ctx);

    const output = {
      synthesis: result.value.finalState,
      votes: result.value.votes ?? [],
      rounds_completed: result.value.rounds,
    };

    // Cache result when session_id was provided.
    if (input.session_id) {
      sessionStore.set(input.session_id, { ...output, created_at: Date.now() });
    }

    return output;
  },
};
