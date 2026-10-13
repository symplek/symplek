# weft-mcp

MCP bridge for Weft: exposes Weft operators as MCP tools so Claude Code, Cursor, and any
MCP-compatible LLM runtime can call them directly.

---

## Installation

```bash
pnpm add weft-mcp
```

---

## Claude Code Setup

Add to `.claude/settings.json`:

```json
{
  "mcpServers": {
    "weft": {
      "command": "node",
      "args": ["./node_modules/weft-mcp/dist/bin.cjs"]
    }
  }
}
```

> **Windows note**: `npx weft-mcp` will not work from Claude Code on Windows because `npx` is
> a `.cmd` shim that requires `shell: true` to spawn. Use the `node dist/bin.cjs` form above.

---

## Cursor Setup

Add to `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "weft": {
      "command": "node",
      "args": ["./node_modules/weft-mcp/dist/bin.cjs"],
      "env": {}
    }
  }
}
```

---

## Tool Reference

### `weft_debate`

**Fixture tool**: exercises the Weft debate operator wiring without making real LLM calls.
Role agents are deterministic stubs. Each returns the input prompt unchanged (`hasMore: false`),
so the synthesis output equals the original prompt. Use it for operator wiring tests,
session-caching demos, and result-shape validation. For real multi-perspective analysis call
`AgentUnit.debate()` with model-backed agents directly.

**Input**:

```json
{
  "prompt": "Should we adopt a microservices architecture?",
  "roles": [
    { "role": "Architect", "model": "claude-opus-4-5" },
    { "role": "DevOps Lead", "model": "gpt-4" }
  ],
  "rounds": 2,
  "session_id": "debate-arch-001"
}
```

**Output**:

```json
{
  "simulated": true,
  "notice": "No debate took place. Every role is a fixed stub that returns the prompt unchanged, so `synthesis` is the prompt itself.",
  "synthesis": "Should we adopt a microservices architecture?",
  "votes": [],
  "rounds_completed": 2
}
```

`session_id` is optional. When provided, the result is cached in process-memory and returned
on subsequent calls with the same `session_id` **and the same prompt, roles and rounds**.
Reusing a `session_id` with any of those changed evicts the stale cache entry and computes a
new result.

---

### `weft_consensus`

**Fixture tool**: exercises the Weft consensus operator wiring without making real LLM calls.
Voters are deterministic stubs that always approve with confidence 0.8. Quorum and veto rules
are enforced by weft-core. Use for operator wiring tests, threshold validation, and result-shape
verification. For real independent agent votes call `AgentUnit.consensus()` with model-backed
voters directly.

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
  "simulated": true,
  "notice": "No evaluation took place. Every voter is a fixed stub that approves, whatever the prompt says. Do not treat `approved` as a decision.",
  "approved": true,
  "score": 1,
  "votes": [
    { "agentId": "voter_0", "decision": "approve", "confidence": 0.8, "weight": 1 },
    { "agentId": "voter_1", "decision": "approve", "confidence": 0.8, "weight": 1 },
    { "agentId": "voter_2", "decision": "approve", "confidence": 0.8, "weight": 1 }
  ],
  "vetoed_by": null
}
```

---

### `weft_tracked`

Record a claim with its stated source URI and confidence score. Returns the claim unchanged
with a SHA-256 content hash (covers `prompt` + `source` URI jointly) and an ISO-8601 timestamp.
Source and confidence are the caller's own assertions: nothing is verified or attested externally.

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
  "timestamp": "2026-04-12T00:00:00.000Z",
  "notice": "Source and confidence are the caller's own claims, recorded verbatim. Nothing was verified or attested. The hash is tamper-evident for (prompt + source); it does not certify the source's trustworthiness."
}
```

The hash is `sha256` over `JSON.stringify([prompt, source])`: unambiguous even when the prompt
or source contains separator characters. Use it to detect accidental or adversarial content
changes across turns; do not treat it as external attestation.

---

## Client: `MCPUnit`

`MCPUnit` wraps an MCP server connection with trust policy evaluation:

```ts
import { MCPUnit } from "weft-mcp";

const mcp = MCPUnit.create({
  transport: {
    transport: "stdio",
    command: "node",
    args: ["./node_modules/weft-mcp/dist/bin.cjs"],
  },
});

const result = await mcp.call("weft_debate", { prompt: "...", roles: [...] });
```

### Default trust policies

Three policies run automatically on every call, in order:

1. **`allowTrustedOnly`**: passes calls whose evidence has `policyVerdict: "allow"` and a
   non-empty `provenanceChain`. Both conditions are always true for a fresh `MCPUnit.call()`,
   so this policy always allows unless you have already downgraded the evidence object.

2. **`requireAttestation`**: quarantines calls with an empty provenance chain. Because
   `MCPUnit.call()` populates the chain before the policy runs, this never quarantines a fresh
   call.

3. **`degradeToReadOnly`**: degrades calls where the evidence is not marked "attested". Because
   the built-in evidence always carries the attested marker, this never degrades a fresh call.

**In short**: the three default policies always allow fresh `MCPUnit.call()` results. They give
you an enforcement hook for callers that work with pre-existing, potentially-downgraded evidence
objects: not a registry check or external signature verification.

To extend the default set:

```ts
import { MCPUnit, createDefaultPolicyEngine } from "weft-mcp";

const mcp = MCPUnit.create({
  transport: { ... },
  policies: [...createDefaultPolicyEngine().policies, myCustomPolicy],
});
```

---

## Development

```bash
pnpm build        # Compile to dist/
pnpm test         # Run vitest
pnpm typecheck    # TypeScript type check
pnpm lint         # Biome lint + format check
```
