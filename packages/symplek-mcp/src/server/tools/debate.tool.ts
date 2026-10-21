/**
 * @module DebateTool - MCP tool definition for the Symplek debate operator
 * @description Wires symplek_debate MCP calls to AgentUnit.debate() operator.
 * Simulated role agents run converge+consensus in a single call; optional
 * session_id caches the result in process-memory for multi-turn access.
 * @rules @.cursor/rules/patterns/029-file-header-contracts.mdc
 */

import { AgentUnit, createContext } from "@symplek/core";
import type { DebateAgent } from "../symplek-core-ops";

// ─── Session Store ────────────────────────────────────────────────────────────
// Keyed by session_id. State is in-process only — not durable across restarts.
// See DESIGN-NOTES.md for trade-offs and production guidance.

interface DebateSessionEntry {
  simulated: true;
  notice: string;
  synthesis: string;
  votes: unknown[];
  rounds_completed: number;
  created_at: number;
  /** M8 fix: the prompt this entry was computed for. A new prompt with the
   *  same session_id is a different debate — return the cached entry only when
   *  the prompt matches. */
  prompt: string;
}

/**
 * Capacity cap for the in-process session cache. Prevents unbounded growth
 * if a misbehaving caller floods unique session_ids — without a cap, the
 * server would eventually OOM. When the cap is hit we evict the oldest
 * entry by insertion order (Map iteration is insertion-ordered).
 */
const SESSION_STORE_CAPACITY = 256;

export const sessionStore = new Map<string, DebateSessionEntry>();

function setSessionEntry(id: string, entry: DebateSessionEntry): void {
  if (sessionStore.size >= SESSION_STORE_CAPACITY && !sessionStore.has(id)) {
    const oldestKey = sessionStore.keys().next().value;
    if (oldestKey !== undefined) sessionStore.delete(oldestKey);
  }
  sessionStore.set(id, entry);
}

// ─── Tool Definition ──────────────────────────────────────────────────────────

export const debateTool = {
  name: "symplek_debate",
  // N52 fix: previous description claimed real multi-perspective LLM analysis.
  // Agents in this tool are fixture stubs — they return the input unchanged.
  // The description now discloses simulation so no caller mistakes output for analysis.
  description:
    "Fixture: exercises the Symplek debate operator wiring without making LLM calls. " +
    "Role agents are deterministic stubs — each returns the input prompt unchanged with hasMore:false. " +
    "The synthesis output equals the original prompt. " +
    "Use for operator wiring tests, session-caching demos, and result-shape validation. " +
    "For real multi-perspective analysis use AgentUnit.debate() with model-backed agents.",
  inputSchema: {
    type: "object" as const,
    properties: {
      prompt: {
        type: "string",
        maxLength: 16_384,
        description: "The question or proposal to debate",
      },
      roles: {
        type: "array",
        maxItems: 32,
        items: {
          type: "object",
          properties: {
            role: { type: "string", maxLength: 256 },
            model: { type: "string", maxLength: 256 },
          },
          required: ["role", "model"],
        },
        description: "Specialist roles that will debate the prompt",
      },
      rounds: {
        type: "number",
        minimum: 1,
        maximum: 16,
        integer: true,
        description: "Number of debate rounds, integer (default: 2)",
      },
      session_id: {
        type: "string",
        maxLength: 128,
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
    simulated: true;
    notice: string;
    synthesis: string;
    votes: unknown[];
    rounds_completed: number;
  }> => {
    // M8 fix: return cached result only when both session_id AND prompt match.
    // A reused session_id with a different prompt is a new debate — clear the
    // stale entry and compute a fresh result rather than returning the wrong
    // synthesis.
    if (input.session_id) {
      const cached = sessionStore.get(input.session_id);
      if (cached) {
        if (cached.prompt === input.prompt) {
          const { created_at: _ts, prompt: _p, ...rest } = cached;
          return rest;
        }
        // Different prompt: stale session — evict and recompute.
        sessionStore.delete(input.session_id);
      }
    }

    // Build simulated DebateAgents — one per role.
    // Each agent signals hasMore: false after one round (single-shot per call).
    // N52: fixture agents — input is returned unchanged; no LLM call is made.
    const agents: Array<DebateAgent<string>> = input.roles.map(
      (r) => (current: string, _round: number) => ({
        result: current,
        hasMore: false,
        reasoning: `fixture agent for role "${r.role}" — input returned unchanged, no LLM call`,
      }),
    );

    const ctx = createContext();
    const result = await AgentUnit.of(input.prompt)
      .debate(agents, { maxRounds: input.rounds ?? 2 })
      .run(ctx);

    const output = {
      // The result says so itself, because a calling agent may act on the
      // payload without re-reading the tool description.
      simulated: true as const,
      notice:
        "No debate took place. Every role is a fixed stub that returns the prompt unchanged, so `synthesis` is the prompt itself.",
      synthesis: result.value.finalState,
      votes: result.value.votes ?? [],
      rounds_completed: result.value.rounds,
    };

    // Cache result when session_id was provided (capped LRU-style; see setSessionEntry).
    // M8: include the prompt in the entry so retrieval can verify it matches.
    if (input.session_id) {
      setSessionEntry(input.session_id, {
        ...output,
        created_at: Date.now(),
        prompt: input.prompt,
      });
    }

    return output;
  },
};
