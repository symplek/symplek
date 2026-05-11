# @weft/mcp

MCP Fabric for Weft — trust-aware tool consumption via Model Context Protocol.

Exposes Weft operators (`debate`, `consensus`, `tracked`) as MCP tools so Claude Code,
Cursor, and any MCP-compatible LLM runtime can call them directly.

---

## Installation

```bash
pnpm add @weft/mcp
```

---

## Claude Code Setup

Add to `.claude/settings.json`:

```json
{
  "mcpServers": {
    "weft": {
      "command": "node",
      "args": ["./node_modules/@weft/mcp/dist/server/index.js"]
    }
  }
}
```

Or with `tsx` (for TypeScript source):

```json
{
  "mcpServers": {
    "weft": {
      "command": "npx",
      "args": ["tsx", "./node_modules/@weft/mcp/src/server/index.ts"]
    }
  }
}
```

---

## Cursor Setup

Add to `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "weft": {
      "command": "node",
      "args": ["./node_modules/@weft/mcp/dist/server/index.js"],
      "env": {}
    }
  }
}
```

---

## Tool Reference

### `weft_debate`

Run a structured multi-agent debate. Multiple specialist agents review a prompt from
their role perspectives; the operator runs converge+consensus and returns a synthesis.

**Input**:

```json
{
  "prompt": "Should we adopt a microservices architecture?",
  "roles": [
    { "role": "Architect", "model": "claude-3-opus" },
    { "role": "DevOps Lead", "model": "gpt-4" },
    { "role": "Security Engineer", "model": "gemini-pro" }
  ],
  "rounds": 2,
  "session_id": "debate-arch-001"
}
```

**Output**:

```json
{
  "synthesis": "After debate, the consensus is...",
  "votes": [{ "agentId": "...", "decision": "approve", "confidence": 0.9, "weight": 1 }],
  "rounds_completed": 2
}
```

`session_id` is optional. When provided, the result is cached in process-memory and
returned on subsequent calls — useful for branching agentic workflows.

---

### `weft_consensus`

Run a consensus vote across multiple agents. Each voter evaluates the prompt
independently; quorum and veto rules are enforced by the Weft operator.

**Input**:

```json
{
  "prompt": "Approve deploying v2.0 to production?",
  "voters": ["architect", "lead-dev", "qa-lead"],
  "threshold": 0.67,
  "vetoers": ["security-lead"]
}
```

**Output**:

```json
{
  "approved": true,
  "score": 0.85,
  "votes": [
    { "agentId": "voter-0", "decision": "approve", "confidence": 0.8, "weight": 1 }
  ],
  "vetoed_by": null
}
```

---

### `weft_tracked`

Wrap a claim or value with source chain provenance. Records a source URI, confidence
score, SHA-256 content hash, and ISO-8601 timestamp for downstream verification.

**Input**:

```json
{
  "prompt": "The authentication module passes all security audits.",
  "source": "file:///path/to/audit-report.md",
  "confidence": 0.95
}
```

**Output**:

```json
{
  "value": "The authentication module passes all security audits.",
  "source": "file:///path/to/audit-report.md",
  "confidence": 0.95,
  "hash": "sha256:a3f2b1...",
  "timestamp": "2026-04-12T00:00:00.000Z"
}
```

---

## Design Notes

See [`src/server/DESIGN-NOTES.md`](./src/server/DESIGN-NOTES.md) for:
- Multi-turn debate: stateless vs session-keyed trade-offs
- Manual stdio transport vs `@modelcontextprotocol/sdk`
- Simulated agents and how to wire real LLM providers

---

## Development

```bash
pnpm build        # Compile to dist/
pnpm test         # Run vitest
pnpm typecheck    # TypeScript type check
```
