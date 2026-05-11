# @weft/core

**Composable AI agents for TypeScript — free and MIT-licensed.**

[![npm](https://img.shields.io/npm/v/@weft/core)](https://www.npmjs.com/package/@weft/core)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18-brightgreen)](package.json)

---

## Install

```bash
npm install @weft/core
# or
pnpm add @weft/core
```

---

## Working in 3 lines

```typescript
import { Weft } from "@weft/core/server";

Weft.configure({ provider: "openai", apiKey: process.env.OPENAI_API_KEY });
const result = await Weft("List three benefits of TypeScript");
console.log(result.value); // "1. Static typing catches errors early..."
```

One import. One config. One result.

> `@weft/core/server` loads provider SDKs — Node.js only. Browser-safe exports live at `@weft/core`.

---

## What you get

- **Lazy agent monad** — `AgentUnit<T>` builds up a computation chain without executing until `.run()` is called
- **Parallel execution** — `AgentUnit.zipAll([a, b, c])` fans out agents and collects all results concurrently
- **Single-round consensus** — `.consensus([voter1, voter2, voter3])` polls voters, tallies confidence-weighted votes
- **Resilience operators** — `.retry(3)`, `.timeout(5000)`, `.fallback(backupAgent)` composable on any unit
- **Zero-trust tracing** — every `.run()` returns a `TrackedResult<T>` envelope with provenance metadata
- **Streaming** — `Weft.stream(task)` returns `AsyncGenerator<string>` for real-time output chunks
- **TypeScript-first** — full inference through every operator, no casts needed

---

## From simple to multi-agent

### Step 1 — One agent

```typescript
import { Weft } from "@weft/core/server";

Weft.configure({ provider: "openai", apiKey: process.env.OPENAI_API_KEY });

const result = await Weft("What is the capital of France?");
console.log(result.value); // "Paris"
```

### Step 2 — Agents in parallel

```typescript
import { AgentUnit, createContext } from "@weft/core";

const ctx = createContext();

const result = await AgentUnit.zipAll([
  AgentUnit.from(async () => "analysis: low risk"),
  AgentUnit.from(async () => "recommendation: proceed"),
]).map(([analysis, rec]) => ({ analysis, recommendation: rec })).run(ctx);

console.log(result.value); // { analysis: "analysis: low risk", recommendation: "proceed" }
```

### Step 3 — Consensus vote

```typescript
import { AgentUnit, createContext } from "@weft/core";

const ctx = createContext();

const voted = await AgentUnit.of("Ship the feature")
  .consensus([
    (_) => ({ decision: "approve" as const, confidence: 0.9 }),
    (_) => ({ decision: "approve" as const, confidence: 0.8 }),
    (_) => ({ decision: "reject" as const,  confidence: 0.6, reasoning: "Needs more testing" }),
  ])
  .run(ctx);

console.log(voted.value.approved);  // true
console.log(voted.value.consensus); // "reached"
```

### Step 4 — Resilience

```typescript
import { AgentUnit, createContext } from "@weft/core";

const ctx = createContext();

const robust = AgentUnit
  .from(async () => callExternalAPI())
  .retry(3)
  .timeout(10_000)
  .fallback(AgentUnit.of({ cached: true, result: "default response" }));

const result = await robust.run(ctx);
```

---

## Key exports

| Export | From | Description |
|---|---|---|
| `AgentUnit` | `@weft/core` | Lazy agent monad — `.from()`, `.of()`, `.map()`, `.flatMap()`, `.zipAll()`, `.race()` |
| `createContext` | `@weft/core` | Create an `AgentContext` for `.run()` calls (zero-arg works) |
| `WeftError` | `@weft/core` | Structured error with `.code`, `.message`, `.action` fields |
| `Weft` | `@weft/core/server` | Zero-boilerplate facade — `Weft(task)`, `.run()`, `.stream()`, `.agent()`, `.configure()`, `.providers()` |

---

## Need more?

`@weft/core` ships the full free-tier operator suite. Upgrade to `@weft/pro` when you need:

- **Multi-round TaCo consensus** — agents share rationale and revote until convergence (reduces error amplification by 17×)
- **Agent antibodies** — pattern-match and reject bad outputs at runtime (XSS, hallucinated fields, schema violations)
- **Built-in observability** — span tracing with wall-clock timing, collector hooks, cost tracking
- **Trust registry** — trusted-traveler lanes with configurable scan depth per agent or caller
- **Teams** — named reusable agent teams with shared configuration
- **Stigmergic coordination** — pheromone-based confidence with evaporation/decay

See [@weft/pro](../weft-pro/README.md) for details.

---

## Links

- [Quickstart](../../docs/weft-quickstart.md) — First agent in 30 seconds
- [Cookbook](../../docs/weft-cookbook.md) — Copy-paste recipes for real patterns
- [API Reference](../../docs/weft-exports.md) — Full method signatures and types
- [GitHub](https://github.com/weft-ai/weft)

---

## License

MIT
