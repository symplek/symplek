# Symplek MCP Server: Tool Reference

The Symplek MCP server exposes three Symplek operators as MCP tools, accessible from Claude Code,
Cursor, and any MCP-compatible LLM runtime over stdio JSON-RPC 2.0.

The entry point is `dist/bin.cjs` (compiled from `src/server/bin.ts`). The transport is a
self-contained readline loop: `@modelcontextprotocol/sdk` is not required at runtime.

---

## Tool Schemas

### `symplek_debate`

**Fixture tool.** Exercises debate operator wiring with deterministic stub agents.
Synthesis equals the input prompt: no LLM calls are made.

| Field | Type | Required | Description |
|---|---|---|---|
| `prompt` | `string` | ✅ | The question or proposal to debate |
| `roles` | `Array<{role: string, model: string}>` | ✅ | Specialist roles (stubs; model field is recorded but not called) |
| `rounds` | `integer` |: | Debate rounds, integer (default: 2) |
| `session_id` | `string` |: | Cache key for process-memory result reuse |

**Output shape**:

```json
{
  "simulated": true,
  "notice": "No debate took place. Every role is a fixed stub that returns the prompt unchanged, so `synthesis` is the prompt itself.",
  "synthesis": "<original prompt>",
  "votes": [],
  "rounds_completed": 2
}
```

Session cache is keyed by `(session_id, prompt)`. A reused `session_id` with a different prompt
evicts the stale entry and recomputes.

---

### `symplek_consensus`

**Fixture tool.** Exercises consensus operator wiring with stub voters that always approve at
confidence 0.8. Quorum and veto rules are enforced by @symplek/core.

| Field | Type | Required | Description |
|---|---|---|---|
| `prompt` | `string` | ✅ | The proposal to vote on |
| `voters` | `string[]` | ✅ | Agent role names (stubs; always approve) |
| `threshold` | `number` | ✅ | Approval threshold (0.0–1.0) |
| `vetoers` | `string[]` |: | Roles with veto power (optional) |

**Output shape**:

```json
{
  "simulated": true,
  "notice": "No evaluation took place. Every voter is a fixed stub that approves, whatever the prompt says. Do not treat `approved` as a decision.",
  "approved": true,
  "score": 0.8,
  "votes": [{ "agentId": "voter-0", "decision": "approve", "confidence": 0.8, "weight": 1 }],
  "vetoed_by": null
}
```

---

### `symplek_tracked`

Record a claim with source URI, confidence, SHA-256 hash, and timestamp.
Source and confidence are the caller's own assertions: nothing is verified externally.

| Field | Type | Required | Description |
|---|---|---|---|
| `prompt` | `string` | ✅ | The agent prompt or claim to record |
| `source` | `string` | ✅ | Source URI: recorded as stated, not verified |
| `confidence` | `number` | ✅ | Confidence score (0.0–1.0): recorded as stated |

**Output shape**:

```json
{
  "value": "<original prompt>",
  "source": "<source URI>",
  "confidence": 0.95,
  "hash": "sha256:<hex>",
  "timestamp": "<ISO-8601>",
  "notice": "Source and confidence are the caller's own claims, recorded verbatim. Nothing was verified or attested. The hash is tamper-evident for (prompt + source); it does not certify the source's trustworthiness."
}
```

Hash input is `JSON.stringify([prompt, source])`, so separator characters inside either field
cannot cause collisions between different `(prompt, source)` pairs.

---

## Adding to Claude Code

Add to `.claude/settings.json`:

```json
{
  "mcpServers": {
    "symplek": {
      "command": "node",
      "args": ["./node_modules/@symplek/mcp/dist/bin.cjs"]
    }
  }
}
```

> **Windows note**: `npx @symplek/mcp` requires `shell: true` to spawn (npx is a `.cmd` shim on
> Windows). Claude Code does not set `shell: true` by default: use the `node dist/bin.cjs`
> form above.

---

## Protocol notes

- Transport: stdio, newline-delimited JSON (one JSON object per line).
- Protocol version: `2024-11-05`.
- `ping` returns `{}` (empty result object per MCP spec).
- Notifications (`notifications/*`, `initialized`, `$/`) never get responses.
- Invalid JSON → `-32700`. Non-object/non-array parse result → `-32600`. Missing `jsonrpc:"2.0"`
  → `-32600`. Object or array `id` → `-32600`. Unknown tool → `-32602`. Missing params on
  `tools/call` → `-32602`.
