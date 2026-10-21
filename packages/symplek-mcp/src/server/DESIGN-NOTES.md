# Symplek MCP Server — W3-B Design Notes

## Multi-Turn Debate: Stateless vs Session-Keyed

The `symplek_debate` operator runs multiple converge rounds internally. MCP tool calls are
designed to be stateless (one request → one response). Two options exist for mapping
the multi-turn operator to the MCP model:

### Option A — Stateless (default, current implementation)

All converge rounds execute within a single MCP call. The caller blocks until the full
debate completes and receives the final synthesis.

```json
{ "tool": "symplek_debate", "prompt": "...", "roles": [...], "rounds": 2 }
// → one response with synthesis + all votes
```

**Pros**: Simple client API; rounds are invisible to the caller.  
**Cons**: Higher per-call latency for large round counts; no intermediate visibility.

**When to use**: Most cases. Default when `session_id` is omitted.

---

### Option B — Session-Keyed (opt-in via `session_id`)

The first call executes all rounds and caches the `DebateResult` in a module-level
`Map<session_id, DebateSessionEntry>`. Subsequent calls with the same `session_id`
return the cached result immediately.

```json
// First call
{ "tool": "symplek_debate", "prompt": "...", "roles": [...], "session_id": "debate-42" }
// → runs debate, caches result, returns synthesis

// Subsequent calls
{ "tool": "symplek_debate", "prompt": "...", "roles": [...], "session_id": "debate-42" }
// → returns cached result (no LLM calls)
```

**Pros**: Allows Claude Code to call `symplek_debate` multiple times in a session without
re-running the expensive debate; useful for branching agentic workflows.  
**Cons**: State is **in-process only** — not durable across server restarts.

---

### Production Recommendation

For production deployments where session state must survive server restarts or be
shared across multiple server instances, replace the module-level `Map` with an
external KV store (Redis, Upstash, DynamoDB). The `sessionStore` export in
`debate.tool.ts` is intentionally isolated to enable this substitution.

```typescript
// Example: replace in-memory store with Redis adapter
import { debateTool, sessionStore } from "./server/tools/debate.tool";
// sessionStore.set / .get / .has → delegate to your KV client
```

---

## Transport: Manual stdio vs @modelcontextprotocol/sdk

The server uses a manual stdio JSON-RPC 2.0 transport (newline-delimited JSON) rather
than the `@modelcontextprotocol/sdk`. The SDK is declared as a `devDependency` but was
not installed in the monorepo at W3-B implementation time due to a workspace peer
dependency conflict in a sibling package.

The manual transport is:
- Self-contained (zero extra runtime dependencies)
- Portable (works in any Node.js environment)
- Compatible with Claude Code, Cursor, and Codex CLI MCP integrations

To switch to the SDK transport when it becomes available, replace the readline-based
loop in `index.ts` with:

```typescript
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

const server = new Server({ name: "symplek", version: "0.1.0" }, { capabilities: { tools: {} } });
server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [...] }));
server.setRequestHandler(CallToolRequestSchema, async (req) => { /* dispatch */ });
const transport = new StdioServerTransport();
await server.connect(transport);
```

---

## Simulated Agents

The debate and consensus tools use **simulated agents** — deterministic functions that
return fixed values without making real LLM calls. This is intentional:

1. The `@symplek/mcp` package has no AI provider dependency
2. The operators still execute their coordination logic (rounds, voting, quorum checks)
3. Real LLM agents can be injected by extending the tool with a model provider option

To add real LLM agents, wire in `@symplek/core`'s `AgentUnit.prompt()` with a provider:

```typescript
import { AgentUnit } from "@symplek/core";
// Real agent example (requires provider dependency):
const agent: DebateAgent<string> = async (current, _round) => ({
  result: await callLLM(`As ${role}, respond to: ${current}`),
  hasMore: false,
});
```
