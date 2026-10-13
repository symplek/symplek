# weft-core

**Composable AI agents for TypeScript. Free, MIT-licensed.**

[![npm](https://img.shields.io/npm/v/weft-core)](https://www.npmjs.com/package/weft-core)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D20-brightgreen)](package.json)

---

## Install

```bash
pnpm add weft-core zod
# or
npm install weft-core zod
```

Node 20 or later. `zod` is a required peer (3.25.28 or later, or 4.x). Schemas from either generation work at runtime. One typing gap: with zod 3.25 installed, a schema built from `zod/v4` does not type-check against the `schema` option, so install zod 4 if you write Zod 4 schemas.

To call a model you also need that provider's SDK and its API key:

| Provider | SDK to install | Key in the environment |
|---|---|---|
| `openai` | `openai` | `OPENAI_API_KEY` |
| `anthropic` | `@anthropic-ai/sdk` | `ANTHROPIC_API_KEY` |
| `google` | `@google/generative-ai` | `GOOGLE_GENERATIVE_AI_API_KEY` |

The composition operators need none of that. They work on any async function.

---

## Working in 3 lines

```typescript
import { Weft } from "weft-core/server";

Weft.configure({ provider: "openai", apiKey: process.env.OPENAI_API_KEY });
const result = await Weft("List three benefits of TypeScript");
console.log(result.value); // "1. Static typing catches errors early..."
```

With the key already in the environment you can skip `configure()`. Weft finds the key and loads the matching provider on the first call. If more than one provider key is set, it takes the first of OpenAI, Anthropic, Google.

> `weft-core/server` loads provider SDKs, so it is Node.js only. Browser-safe exports live at `weft-core`.

---

## What you get

- **Lazy units.** `AgentUnit<T>` builds a computation chain and runs nothing until `.run()` is called.
- **Parallel execution.** `AgentUnit.zipAll([a, b, c])` runs units side by side and returns the results in order.
- **Single-round consensus.** `.consensus([voter1, voter2, voter3])` polls the voters and tallies the vote. Every voter counts equally unless you pass `weights`; a voter's own `confidence` is recorded, not used as its weight.
- **Resilience operators.** `.retry(3)`, `.timeout(5000)` and `.fallback(backup)` compose on any unit.
- **A result envelope.** Every `.run()` returns a `TrackedResult<T>`: your value plus a source label and a confidence figure. Read [what those fields mean](#what-run-gives-you-back) before relying on them.
- **Structured output.** Pass a Zod schema and get a validated object back.
- **Streaming.** `Weft.stream(task)` returns an `AsyncGenerator<string>` of output chunks.

---

## From simple to multi-agent

### Step 1: one agent

```typescript
import { Weft } from "weft-core/server";

Weft.configure({ provider: "openai", apiKey: process.env.OPENAI_API_KEY });

const result = await Weft("What is the capital of France?");
console.log(result.value); // "Paris"
```

### Step 2: agents in parallel

```typescript
import { Weft, AgentUnit, createContext } from "weft-core/server";

const ctx = createContext();

const result = await AgentUnit.zipAll([
  Weft.unit(async () => "low risk"),
  Weft.unit(async () => "proceed"),
]).map(([analysis, recommendation]) => ({ analysis, recommendation })).run(ctx);

console.log(result.value); // { analysis: "low risk", recommendation: "proceed" }
```

`Weft.unit(fn)` is the same as `AgentUnit.from(fn)`, reachable from the namespace you already imported.

### Step 3: consensus vote

```typescript
import { Weft, createContext } from "weft-core/server";

const ctx = createContext();

// Start from a Weft(task) call and move into coordination with .coordinate()
const voted = await Weft("Should we ship the feature?")
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

Or start from a plain value with `Weft.of`:

```typescript
const voted = await Weft.of("Ship the feature")
  .consensus([voter1, voter2, voter3])
  .run(ctx);
```

### Step 4: resilience

```typescript
import { Weft, createContext } from "weft-core/server";

const ctx = createContext();

type Reply = { cached: boolean; result: string };

const robust = Weft
  .unit<Reply>(async () => callExternalAPI())
  .retry(3)
  .timeout(10_000)
  .fallback(Weft.of<Reply>({ cached: true, result: "default response" }));

const result = await robust.run(ctx);
```

`.timeout()` stops waiting after the deadline. It does not cancel the work underneath. The fallback has to produce the same type as the unit it backs up.

---

## Structured output

Pass a Zod schema and the reply comes back parsed and validated:

```typescript
import { ai } from "weft-core/server";
import { z } from "zod";

const Review = z.object({
  sentiment: z.enum(["positive", "negative"]),
  tags: z.array(z.string()),
});

const review = await ai("Classify this review: fast delivery, great fit", { schema: Review });
console.log(review.sentiment); // "positive"
```

Weft sends the model the JSON Schema for your Zod type, asks for JSON only, then validates the reply. A reply that does not match throws a `WeftError` with code `INVALID_SCHEMA`. Nothing forces the model to comply beyond that instruction (plus JSON mode on the providers that have one), so plan for the error on weaker models.

---

## Which model runs

Set one yourself and that is the one that runs: `Weft.configure({ model })`, or the `model` option on a call.

If you set none, Weft picks from a built-in table:

| Provider | Default | `quality: "high"` | `quality: "fast"` |
|---|---|---|---|
| `openai` | `gpt-4o-mini` | `gpt-4o` | `gpt-4o-mini` |
| `anthropic` | `claude-sonnet-5-5` | `claude-opus-5-5` | `claude-haiku-5-5` |
| `google` | `gemini-3.8-flash` | `gemini-3.8-flash` | `gemini-3.5-flash-lite` |

One thing to know about before it shows up on a bill. With no model and no `quality` set, a prompt longer than 500 characters, or one containing "analyze", "complex", "reason", "think", "evaluate", "summarize" or "extract", is sent to the `high` column. Set `model` or `quality` if you want to decide that yourself.

Providers retire model ids. If a default stops working, set `model` explicitly and upgrade when a release updates the table.

Two provider behaviours worth knowing. The Anthropic adapter does not forward `temperature` or `topP`, because current Claude models reject them. When a provider declines a request, the call throws `PROVIDER_ERROR`. Reaching the output limit before writing any answer text also throws `PROVIDER_ERROR`. A call that stops normally before writing any text returns an empty string.

---

## What `.run()` gives you back

`.run(ctx)` resolves to a `TrackedResult<T>`: `value`, `source`, `confidence`, `sourceChain` and `minChainConfidence`.

Be clear about what the numbers are:

- `source` is `"agent"` for everything `.run()` produces. `.tracked({ source, confidence })` attaches your own label, which you then read at `result.value.source`: the outer envelope still says `"agent"`.
- `confidence` starts at 0.85 and moves by a fixed amount per operator in the chain (for example +0.10 for `consensus`, -0.05 for `retry`). It never looks at the output.
- `objectiveConfidence`, on consensus and debate results, is the figure calculated from the votes themselves.

The [root README](../../README.md#what-run-gives-you-back) has the full table.

---

## Record and replay

`.rehearse()` runs a unit once and records the outcome. `.replay(trace)` returns that stored outcome later without running the unit, after checking the trace has not been altered.

It records the final output, not the steps inside the unit, and replay does not re-run your agent. The [root README](../../README.md#record-and-replay) says exactly what it does and does not do.

---

## Key exports

| Export | From | Description |
|---|---|---|
| `AgentUnit` | `weft-core` | The lazy unit: `.from()`, `.of()`, `.map()`, `.flatMap()`, `.zipAll()`, `.race()` and the operators above |
| `createContext` | `weft-core` | Creates the `AgentContext` that `.run()` takes. Works with no arguments |
| `WeftError` | `weft-core` | Structured error with `.code`, `.message` and `.action` |
| `InMemoryIdempotencyStore` | `weft-core` | Idempotency store for `.run(ctx, { idempotency })`. Dedupes side-effecting runs (`reject` or `return-cached`, optional TTL) |
| `Weft` | `weft-core/server` | The facade: `Weft(task)`, `.run()`, `.stream()`, `.agent()`, `.unit()`, `.of()`, `.configure()`, `.providers()` |
| `ai` | `weft-core/server` | One model call, with an optional Zod `schema` |

---

## Need more?

Everything above is in `weft-core` under MIT, along with teams, the solo gate, coherence, confidence, interview, change-kernel, contracts and observability.

[`weft-pro`](../weft-pro/README.md) adds four things, behind a license key:

- **Multi-round TaCo consensus.** Agents see each other's rationale and revote until they converge.
- **Stigmergic confidence.** Pheromone-style coordination with evaporation and decay.
- **Agent antibodies.** Scans agent output against registered patterns: reject, warn or quarantine.
- **Trust registry.** Trusted-traveler lanes with a configurable scan depth per agent.

---

## Links

- [Record and replay](../../docs/ARCHITECTURE.md): what `.rehearse()` and `.replay()` do, and the pieces underneath
- [Tier boundary](../../docs/tier-boundary.md): what is in `weft-core` and what is in `weft-pro`
- [GitHub](https://github.com/wefthq/weft)

---

## License

MIT
