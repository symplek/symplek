# @symplek/core

**Composable AI agents for TypeScript — free and MIT-licensed.**

[![npm](https://img.shields.io/npm/v/@symplek/core)](https://www.npmjs.com/package/@symplek/core)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D20-brightgreen)](package.json)

---

## Install

```bash
npm install @symplek/core
# or
pnpm add @symplek/core
```

---

## Working in 3 lines

```typescript
import { Symplek } from "@symplek/core/server";

Symplek.configure({ provider: "openai", apiKey: process.env.OPENAI_API_KEY });
const result = await Symplek("List three benefits of TypeScript");
console.log(result.value); // "1. Static typing catches errors early..."
```

One import. One config. One result.

> `@symplek/core/server` loads provider SDKs — Node.js only. Browser-safe exports live at `@symplek/core`.

---

## What you get

- **Lazy agent monad** — `AgentUnit<T>` builds up a computation chain without executing until `.run()` is called
- **Parallel execution** — `AgentUnit.zipAll([a, b, c])` fans out agents and collects all results concurrently
- **Single-round consensus** — `.consensus([voter1, voter2, voter3])` polls voters, tallies confidence-weighted votes
- **Resilience operators** — `.retry(3)`, `.timeout(5000)`, `.fallback(backupAgent)` composable on any unit
- **Zero-trust tracing** — every `.run()` returns a `TrackedResult<T>` envelope with provenance metadata
- **Streaming** — `Symplek.stream(task)` returns `AsyncGenerator<string>` for real-time output chunks
- **TypeScript-first** — full inference through every operator, no casts needed

---

## From simple to multi-agent

### Step 1 — One agent

```typescript
import { Symplek } from "@symplek/core/server";

Symplek.configure({ provider: "openai", apiKey: process.env.OPENAI_API_KEY });

const result = await Symplek("What is the capital of France?");
console.log(result.value); // "Paris"
```

### Step 2 — Agents in parallel

```typescript
import { Symplek, AgentUnit, createContext } from "@symplek/core/server";

const ctx = createContext();

const result = await AgentUnit.zipAll([
  Symplek.unit(async () => "analysis: low risk"),
  Symplek.unit(async () => "recommendation: proceed"),
]).map(([analysis, rec]) => ({ analysis, recommendation: rec })).run(ctx);

console.log(result.value); // { analysis: "analysis: low risk", recommendation: "proceed" }
```

`Symplek.unit(fn)` is the bridge from facade to composition — same as `AgentUnit.from(fn)`, but reachable from the namespace you already imported.

### Step 3 — Consensus vote

```typescript
import { Symplek, createContext } from "@symplek/core/server";

const ctx = createContext();

// Start from a Symplek(task) call and flow into multi-agent coordination via .coordinate()
const voted = await Symplek("Should we ship the feature?")
  .coordinate()
  .consensus([
    (_) => ({ decision: "approve" as const, confidence: 0.9 }),
    (_) => ({ decision: "approve" as const, confidence: 0.8 }),
    (_) => ({ decision: "reject" as const,  confidence: 0.6, reasoning: "Needs more testing" }),
  ])
  .run(ctx);

console.log(voted.value.approved);  // true
console.log(voted.value.consensus); // "reached"
```

Or start from a plain value with `Symplek.of`:

```typescript
const voted = await Symplek.of("Ship the feature")
  .consensus([voter1, voter2, voter3])
  .run(ctx);
```

### Step 4 — Resilience

```typescript
import { Symplek, createContext } from "@symplek/core/server";

const ctx = createContext();

const robust = Symplek
  .unit(async () => callExternalAPI())
  .retry(3)
  .timeout(10_000)
  .fallback(Symplek.of({ cached: true, result: "default response" }));

const result = await robust.run(ctx);
```

One import. `Symplek(task)` for the simple case, `Symplek.unit(fn)` / `Symplek.of(value)` / `.coordinate()` to flow into consensus, parallel, retry, fallback. No second namespace to discover.

---

## Key exports

| Export | From | Description |
|---|---|---|
| `AgentUnit` | `@symplek/core` | Lazy agent monad — `.from()`, `.of()`, `.map()`, `.flatMap()`, `.zipAll()`, `.race()` |
| `createContext` | `@symplek/core` | Create an `AgentContext` for `.run()` calls (zero-arg works) |
| `SymplekError` | `@symplek/core` | Structured error with `.code`, `.message`, `.action` fields |
| `InMemoryIdempotencyStore` | `@symplek/core` | Injectable idempotency store for `.run(ctx, { idempotency })` — dedupes side-effecting runs (`reject` / `return-cached`, optional TTL) |
| `Symplek` | `@symplek/core/server` | Zero-boilerplate facade — `Symplek(task)`, `.run()`, `.stream()`, `.agent()`, `.unit()`, `.of()`, `.configure()`, `.providers()` |

---

## Need more?

`@symplek/core` ships the full free-tier operator suite. Upgrade to `@symplek/pro` when you need:

- **Multi-round TaCo consensus** — agents share rationale and revote until convergence
- **Agent antibodies** — pattern-match and reject bad outputs at runtime (XSS, hallucinated fields, schema violations)
- **Advanced observability** — multi-agent trace aggregation, cost dashboards, distributed tracing
- **Trust registry** — trusted-traveler lanes with configurable scan depth per agent or caller
- **Teams** — named reusable agent teams with shared configuration
- **Stigmergic coordination** — pheromone-based confidence with evaporation/decay

See [@symplek/pro](../symplek-pro/README.md) for details.

---

## Links

- [Architecture overview](../../docs/ARCHITECTURE.md) — How @symplek/core is structured
- [Tier boundary](../../docs/tier-boundary.md) — What is free vs. pro
- [Full architecture reference](../../docs/ARCHITECTURE-FULL.md) — Deep-dive on every module
- [GitHub](https://github.com/symplek/symplek)

---

## License

MIT
