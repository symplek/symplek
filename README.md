# Weft

Composable agent primitives for TypeScript.

---

## The problem

Coordinating multiple LLM calls in TypeScript usually means writing 80+ lines of scaffolding: promise chains, error handling, retry logic, consensus aggregation, and result tracking — before you get to any actual agent logic.

Weft replaces that scaffolding with a small algebra. The same coordination patterns — retry, fallback, parallel consensus, iterative refinement — compose as method chains on a single type: `AgentUnit<T>`.

**15 lines of Weft:**

```typescript
import { AgentUnit, createContext } from "@weft/core";

const ctx = createContext();

const result = await AgentUnit.from(async () => {
  const resp = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "gpt-4o", messages: [{ role: "user", content: "Summarise this: ..." }] }),
  });
  return (await resp.json()).choices[0].message.content as string;
})
  .retry(3, { baseDelayMs: 500 })
  .timeout(10_000)
  .fallback(AgentUnit.of("Summary unavailable."))
  .run(ctx, { trustMode: "legacy" });

console.log(result);
```

**Equivalent without Weft: ~80 lines** of try/catch, `Promise.race`, setTimeout, custom error classes, and a `while` loop.

---

## Install

```
pnpm add @weft/core
```

Node 18+. No required peer dependencies for the core package.

---

## Packages

| Package | Description | License |
|---|---|---|
| `@weft/core` | `AgentUnit` algebra: operators, error handling, observability | MIT |
| `@weft/react` | React hooks (`useWeftStream`, `AIErrorBoundary`) | MIT |
| `@weft/convex` | Convex action bindings | MIT |
| `@weft/cli` | Scaffolding and agent debugging CLI | MIT |
| `@weft/mcp` | MCP server exposing Weft operations as tool calls | MIT |
| `@weft/harness` | Unit-testing harness for AgentUnit compositions | MIT |
| `@weft/testing` | Vitest utilities and mock factories | MIT |
| `@weft/devtools` | Chrome DevTools extension bridge for agent traces | MIT |
| `@weft/pro` | Organisational features: TaCo consensus, trust registry, antibodies | BSL 1.1 |

---

## Core operators

All operators on `AgentUnit<T>` are free (MIT). The full list:

**Composition**
- `.map(fn)` — transform the resolved value
- `.flatMap(fn)` / `.chain(fn)` — sequence two computations
- `.pipe(fn)` — alias for map with explicit typing

**Resilience**
- `.retry(n, opts?)` — exponential backoff retry
- `.timeout(ms)` — hard deadline
- `.fallback(unit)` — backup AgentUnit on failure
- `.orElse(value)` — static value on failure

**Coordination**
- `AgentUnit.zipAll(units)` — parallel execution, ordered results
- `AgentUnit.race(units)` — return first to settle
- `.consensus(voters, opts?)` — single-round multi-voter decision
- `.converge(agents, opts?)` — iterative multi-agent refinement
- `.debate(agents, opts?)` — converge + unanimous sign-off
- `.dialectic(leader, advisors, opts?)` — thesis/antithesis/synthesis

**Reliability**
- `.rehearse(opts?)` — record execution trace
- `.replay(trace, opts?)` — deterministic replay
- `.solo(opts?)` — autonomous execution with confidence gate
- `.coherence(opts?)` — post-consensus coherence check
- `.interview(config)` — lazy human-in-the-loop configuration
- `.conduct(handlers)` — execute a pending interview

**Tracking**
- `.track(opts?)` — source-tracking wrapper
- `.tap(fn)` — side-effect without modifying value

**Observability** (also free, in `@weft/core`)
- `observable(unit, opts?)` — emit trace entries for a unit
- `createOperatorSpan(type, name, parentSpanId?)` — manual span timing
- `getTraces()` / `clearTraces()` — in-memory trace store
- `configureObservability(opts)` — verbosity, cost/error tracking, collector

---

## Status

Pre-1.0. API is stabilising but may change between minor versions. We commit to a changelog entry for every breaking change and a migration path in the release notes.

---

## Documentation

- [Architecture](docs/ARCHITECTURE.md) — canonical vs mirror model, package structure, known asymmetries
- [GitHub Discussions](https://github.com/wefthq/weft/discussions) — questions, feature proposals, show-and-tell

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Short version: this repo is a distribution mirror — source changes originate upstream. External contributions are reviewed here and backported. File bugs as Issues; propose features in Discussions first.

---

## Licence

`@weft/core` and all packages except `@weft/pro` are MIT.  
`@weft/pro` is [Business Source License 1.1](packages/weft-pro/LICENSE) — source-available; converts to MIT on 2030-04-24.

See [LICENSE](LICENSE) for the full per-package breakdown.
