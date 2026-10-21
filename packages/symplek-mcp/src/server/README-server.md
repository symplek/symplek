# Symplek MCP Server — Tool Reference

The Symplek MCP server exposes three Symplek operators as MCP tool calls, making them available to
Claude Code, Cursor, and any MCP-compatible LLM runtime.

---

## Tool Schemas

### `symplek_debate`

Run a structured multi-agent debate. Specialist agents review the prompt from their role
perspectives; a synthesizer agent produces a final synthesis.

| Field | Type | Required | Description |
|---|---|---|---|
| `prompt` | `string` | ✅ | The question or proposal to debate |
| `roles` | `Array<{role: string, model: string}>` | ✅ | Specialist roles that will debate |
| `rounds` | `number` | — | Debate rounds (default: 2) |

**Output shape** (W3-B):
```json
{
  "synthesis": "string — final synthesized answer",
  "votes": [{ "role": "string", "position": "string", "confidence": 0.0 }],
  "rounds_completed": 2
}
```

---

### `symplek_consensus`

Run a consensus vote across multiple agents. Each voter evaluates the prompt independently.

| Field | Type | Required | Description |
|---|---|---|---|
| `prompt` | `string` | ✅ | The proposal to vote on |
| `voters` | `string[]` | ✅ | Agent role names to vote |
| `threshold` | `number` | ✅ | Approval threshold (0.0–1.0) |
| `vetoers` | `string[]` | — | Roles with veto power |

**Output shape** (W3-B):
```json
{
  "approved": true,
  "score": 0.85,
  "votes": [{ "role": "string", "approved": true, "reason": "string" }],
  "vetoed_by": null
}
```

---

### `symplek_tracked`

Wrap a claim or value with source chain provenance. Records source URI, confidence score,
and content hash for downstream verification.

| Field | Type | Required | Description |
|---|---|---|---|
| `prompt` | `string` | ✅ | The agent prompt or claim to track |
| `source` | `string` | ✅ | Source URI (file path or URL) |
| `confidence` | `number` | ✅ | Confidence score (0.0–1.0) |

**Output shape** (W3-B):
```json
{
  "value": "string — original prompt",
  "source": "string — source URI",
  "confidence": 0.9,
  "hash": "sha256:abc123...",
  "timestamp": "ISO-8601"
}
```

---

## Adding to Claude Code

Add to `.claude/settings.json`:

```json
{
  "mcpServers": {
    "symplek": {
      "command": "node",
      "args": ["./node_modules/@symplek/mcp/dist/server/index.js"],
      "env": {}
    }
  }
}
```

Or via stdio transport (W3-B):
```json
{
  "mcpServers": {
    "symplek": {
      "command": "npx",
      "args": ["@symplek/mcp"],
      "env": {}
    }
  }
}
```

---

## Open Design Question: Multi-Turn Operators and Stateless MCP

The `symplek_debate` operator runs multiple rounds internally. MCP tool calls are stateless
(one request → one response). Two options exist for mapping multi-turn operators:

### Option A — Session-keyed server-side state

The MCP server holds a session store keyed by `session_id`. The first call starts the debate
and returns a `session_id`; the caller can poll `/status/{session_id}` or wait for the
streamed final response. Rounds execute server-side.

**Pros**: Simple client API, rounds are invisible to the caller.
**Cons**: Requires persistent server process; statefulness is unusual for MCP.

### Option B — Round-per-call with session_id threading

Each call executes one round and returns partial results plus a `session_id`. The next call
passes `session_id` to continue. The final round returns `done: true` with the synthesis.

**Pros**: Fully stateless server; Claude Code can inspect intermediate round results.
**Cons**: More complex client logic; round state must be passed by the caller.

**Current decision**: Deferred to W3-B implementation. The schema stubs are round-agnostic
and can accommodate either pattern. W3-B should resolve this via a design decision record
before wiring the actual operator.
