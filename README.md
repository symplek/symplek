# Weft

Composable agent primitives for TypeScript.

---

## The problem

Coordinating several LLM calls in TypeScript means writing the same scaffolding every time: promise chains, error handling, retry loops, vote counting, result tracking. All of it before you get to any actual agent logic.

Weft replaces that scaffolding with a small algebra. Retry, fallback, parallel consensus and iterative refinement compose as method chains on a single type: `AgentUnit<T>`.

### Multi-agent consensus in 10 lines

Three agents vote on whether a contract clause is fair. The votes run in parallel and the result carries every one of them:

```typescript
import { AgentUnit, createContext } from "weft-core";

const ctx = createContext();

const result = await AgentUnit.from(async () =>
  "The contractor shall bear all costs arising from delays, regardless of cause."
)
  .consensus([
    (clause) => analyseAsLegalExpert(clause),
    (clause) => analyseAsContractor(clause),
    (clause) => analyseAsMediator(clause),
  ])
  .run(ctx);

console.log(result.value.approved);          // false
console.log(result.value.weightedApproval);  // 0.333...
console.log(result.value.votes);             // [{ decision: "reject", confidence: 0.92, ... }, ...]
```

The three `analyseAs...` functions are yours. Each one takes the clause and returns `{ decision: "approve" | "reject" | "abstain", confidence, reasoning? }`. The output shown is what you get when two of them reject and one approves.

No agent registration. No routing config. No network topology. Hand it functions and get back the decision, every vote, and a confidence figure worked out from how the voters split (`result.value.objectiveConfidence`).

### Simple AI calls with the Weft facade

For single-prompt work, the `Weft` callable is the fastest path:

```typescript
import { Weft } from "weft-core/server";

Weft.configure({ provider: "anthropic", model: "claude-sonnet-5-5" });

const result = await Weft("Summarise this contract in three bullet points");
console.log(result.value);
```

This one calls a real model, so it needs two things the first example does not: the provider's SDK (`pnpm add @anthropic-ai/sdk`) and `ANTHROPIC_API_KEY` in your environment. The other supported providers are `openai` (SDK `openai`, key `OPENAI_API_KEY`) and `google` (SDK `@google/generative-ai`, key `GOOGLE_GENERATIVE_AI_API_KEY`). Miss either and the call fails with a `PROVIDER_ERROR` that names what to install or set.

With the key in the environment, `Weft.configure()` is optional: the first call finds the key and loads the matching provider. Leave `model` out and Weft picks one for you, using the provider's larger model for long or analysis-style prompts. [`weft-core`'s README](packages/weft-core/README.md#which-model-runs) has the table and the exact rule.

### From single call to coordination: `.coordinate()`

The facade and the coordination algebra connect through `.coordinate()`. Start simple, compose up:

```typescript
import { Weft, createContext } from "weft-core/server";

Weft.configure({ provider: "anthropic", model: "claude-sonnet-5-5" });
const ctx = createContext();

const result = await Weft("Analyse this contract clause for risk")
  .coordinate()
  .consensus([
    (analysis) => reviewAsLegalCounsel(analysis),
    (analysis) => reviewAsProjectManager(analysis),
    (analysis) => reviewAsFinanceDirector(analysis),
  ])
  .retry(2)
  .run(ctx);
```

One import. The same chain handles the model call, the vote and the retry.

### Resilience without coordination

If you just need retry, timeout, and fallback, that composes too:

```typescript
import { AgentUnit, createContext } from "weft-core";

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
  .run(ctx);

console.log(result.value); // the summary, or "Summary unavailable." if all three attempts fail
```

Written by hand, that is a retry loop with backoff, a `Promise.race` against a timer, and a try/catch for the fallback. Here it is three method calls.

---

## What `.run()` gives you back

Every `.run(ctx)` resolves to a `TrackedResult<T>`: your value, plus a few fields about where it came from.

```typescript
import { AgentUnit, createContext } from "weft-core";

const approve = () => ({ decision: "approve" as const, confidence: 0.9 });
const result = await AgentUnit.of("ship it")
  .consensus([approve, approve, approve])
  .run(createContext());

console.log(result.value.approved);     // true
console.log(result.source);             // "agent": always, from .run()
console.log(result.confidence);         // 0.95: the 0.85 base plus 0.10 for consensus
console.log(result.sourceChain);        // ["agent"]
console.log(result.minChainConfidence); // 0.95
```

Be clear about what that `confidence` number is. It starts at 0.85 and moves by a fixed amount for each operator in the chain: +0.10 for `consensus`, +0.15 for `converge` or `debate`, +0.10 for `dialectic`, -0.05 for `retry`, -0.10 for `fallback`. It never looks at the output. A unanimous rejection scores the same 0.95 as a unanimous approval, and a `retry` that never had to retry still costs 0.05.

The number that does reflect what happened is `objectiveConfidence` on a consensus or debate result. That one is calculated from the votes themselves: agreement rate, entropy and variance.

Two more pieces:

- `.tracked({ source, confidence })` lets you label a result yourself, for example `source: "tool"` or `source: "verified"`.
- `isTrackedResult(x)` tells a result Weft produced from a look-alike object.

---

## Install

```
pnpm add weft-core zod
```

Node 20 or later. `zod` is a required peer dependency. The provider SDKs (`@anthropic-ai/sdk`, `openai`, `@google/generative-ai`) and the OpenTelemetry packages are optional peers: install the ones you call.

---

## Packages

| Package | What is in it | License |
|---|---|---|
| `weft-core` | `AgentUnit` algebra: operators, error handling, record and replay, observability, provider adapters | MIT |
| `weft-react` | React bindings: `useAgent`, `useConsensus`, `useSwarm`, `AIProvider`, `useAIConfig`, `AIErrorBoundary` | MIT |
| `weft-convex` | Convex action helpers: `withAI`, `streamToMutation`, activity and cost middleware | MIT |
| `weft-cli` | The `weft` command: `init`, `add`, `validate`, `generate`, `migrate` | MIT |
| `create-weft` | Wrapper that runs `weft init`. Held back from release: the name `create-weft` on npm is someone else's package | MIT |
| `weft-mcp` | MCP client (`MCPUnit`, `TrustPolicyEngine`) plus a stdio demo server. The default policies do not restrict anything yet, and the server's `weft_debate` and `weft_consensus` tools run on stub agents, not models | MIT |
| `weft-harness` | Plan, permission-gate and execute operators for agent sessions. Pre-alpha: no agent SDK is wired yet, so every result is a stand-in | MIT |
| `weft-testing` | Re-exports the record and replay engine from `weft-core/rehearsal` | MIT |
| `weft-devtools` | Chrome DevTools extension for agent traces. Private, not published to npm | MIT |
| `weft-pro` | TaCo consensus, stigmergy, antibodies, trust registry. Needs a licence key to import | BSL 1.1 |

The examples in this README use `weft-core` only.

---

## Core operators

Every operator on `AgentUnit<T>` ships in `weft-core` under MIT.

**Create**
- `AgentUnit.of(value)`: lift a value
- `AgentUnit.from(fn)`: wrap an async function of the context
- `AgentUnit.fromPromise(promise)`, `AgentUnit.fromWithFallback(fn, fallbackFn)`, `AgentUnit.fail(error)`

**Composition**
- `.map(fn)`: transform the resolved value
- `.flatMap(fn)` / `.chain(fn)`: sequence two computations
- `.branch(pred, ifTrue, ifFalse)`: pick the next unit from the value
- `.tap(fn)`: side effect, value unchanged

**Resilience**
- `.retry(n, opts?)`: up to `n` attempts with exponential backoff and jitter
- `.timeout(ms)`: fail if not finished in `ms`. The work underneath is not cancelled
- `.fallback(unit)`: run a backup `AgentUnit` on failure
- `.orElse(value)`: static value on failure
- `.compensate(fn)`: run a rollback function when this unit fails
- `.saga(steps)`: execute/undo pairs, undone in reverse on failure
- `.supervised(predicate, review)`: send selected outputs to a human reviewer

**Coordination**
- `AgentUnit.zipAll(units)`: run in parallel, results in input order
- `.zip(other)`: run two in parallel, get a tuple
- `AgentUnit.race(units)`: first to settle wins, including a failure
- `.consensus(voters, opts?)`: single-round vote. Voters count equally unless you pass `weights`
- `.converge(agents, opts?)`: iterate until every agent says it is done
- `.debate(agents, opts?)`: converge, then a unanimous sign-off
- `.dialectic(leader, advisors, opts?)`: thesis, critiques, synthesis
- `.reflect(opts?)`: critique, verify and optionally improve the output with agents you pass in. Without them it only runs a built-in structural check
- `.coherence(opts?)`: coherence score and threshold check after a consensus
- `.solo(opts?)`: gate. Passes the value through only when confidence, coherence and risk clear the thresholds, otherwise throws `SoloBlockedError`

**Human in the loop**
- `.interview(config)`: set up a question and answer round against a Zod schema
- `.conduct(handlers)`: run it, calling your `onQuestion` handler for each question

**Contracts and model hints**
- `.provides(schema)` / `.expects(schema, selector)`: validate output or input against a Zod schema
- `.model(name)` / `.quality(level)`: per-step model and quality hints, handed to the unit through the context

**Record and replay**
- `.rehearse(opts?)`: run once and record a trace of the outcome
- `.replay(trace, opts?)`: check a recorded trace and return its stored output without running anything

**Tracking**
- `.tracked({ source, confidence })`: label the result with a source and confidence you supply

**Run**
- `.run(ctx, opts?)`: execute with a context from `createContext()`
- `.runStandalone()`: execute without building a context first

**Observability** (also in `weft-core`)
- `observable(unit, opts?)`: record one trace entry when the unit succeeds. No timing, and failures are not recorded
- `createOperatorSpan(type, name, parentSpanId?)`: a manually timed span, recorded when you call `.end()`
- `getTraces()` / `clearTraces()`: in-memory trace store
- `configureObservability(opts)`: verbosity and an optional collector callback
- `configureOpenTelemetry()` / `exportTraces()` / `shutdownOpenTelemetry()`: export the stored traces as OpenTelemetry spans (optional peer packages)

---

## Record and replay

`.rehearse()` runs a unit once and keeps the outcome. `.replay(trace)` hands that outcome back later without running the unit, after checking the trace has not been altered.

```typescript
import { AgentUnit, createContext } from "weft-core";

const ctx = createContext();

let runs = 0;
const flaky = AgentUnit.from(async () => {
  runs++;
  if (Math.random() < 0.5) throw new Error("upstream timeout");
  return { answer: 42 };
}).retry(20, { baseDelayMs: 1 });

// Record: runs the unit once (retries included) and keeps the outcome.
const recorded = await flaky.rehearse().run(ctx);
const { trace } = recorded.value;
console.log(trace.events.map((e) => e.type)); // ["agent_start", "agent_end"]

// Replay: nothing runs. The stored output comes back after its hashes are checked.
const runsBefore = runs;
const replayed = await flaky.replay(trace).run(ctx);
console.log(replayed.value.value);   // { answer: 42 }
console.log(replayed.value.matched); // true
console.log(runs === runsBefore);    // true: the unit was not called again
```

What that buys you: capture a good run of a flaky or expensive chain once, then reuse its output in tests and demos with no model call and no tokens spent.

What it does not do yet, so nobody finds out the hard way:

- **The trace is the outcome, not the steps.** `.rehearse()` records two events, `agent_start` and `agent_end`, plus the final output and its hash. Model calls, tool calls and intermediate values inside the unit are not recorded.
- **Replay does not re-run your agent.** It cannot tell you whether today's code would still produce the recorded output. Replay the same trace on a completely different unit and you still get `matched: true`.
- **`matched` is an integrity check on the trace.** An edited event throws `ReplayDivergenceError`. An edited output comes back with `matched: false` and a critical divergence. The hashes are DJB2, a fast 32-bit checksum, not a cryptographic one.

`FileStorage` (from `weft-core/rehearsal`) saves and loads traces as JSON files. The lower-level pieces, `TraceRecorder` and `RecordingLLMInterceptor`, are exported if you want to record individual model calls yourself.

**[How record and replay works](docs/ARCHITECTURE.md)**

> **Legal disclaimer: replay.** `.replay()` returns the output stored in a trace. It does not execute your agent, your operators or any model, so it says nothing about what a fresh run would produce today. The integrity hashes are a non-cryptographic checksum. Replay is a testing and debugging aid, not a cryptographic audit trail. Do not rely on it as evidence of correctness in regulated or compliance-critical workflows without independent verification.

---

## Status

Beta. `weft-core` and `weft-pro` are on a `1.0.0-beta` line; the other packages are `0.x`. The API may change between beta releases. We commit to a changelog entry for every breaking change.

---

## Documentation

- [Record and replay](docs/ARCHITECTURE.md): what `.rehearse()` and `.replay()` do, and the building blocks underneath
- [Tier boundary](docs/tier-boundary.md): what is in `weft-core` and what is in `weft-pro`
- [GitHub Discussions](https://github.com/wefthq/weft/discussions): questions, feature proposals, show-and-tell

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). File bugs as Issues. Propose features in Discussions first.

---

## Licence

`weft-core` and all packages except `weft-pro` are MIT.  
`weft-pro` is [Business Source License 1.1](packages/weft-pro/LICENSE): source-available, converting to MIT on the Change Date in that file.

See [LICENSE](LICENSE) for the full per-package breakdown.
