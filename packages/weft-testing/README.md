# weft-testing

Testing utilities for Weft agent compositions. Mocks, fixtures, deterministic providers, replay harness, chaos injection — everything you need to write fast, repeatable tests of `AgentUnit<T>` chains without hitting real LLM APIs.

**Pre-1.0. The API will move.**

---

## Install

```bash
pnpm add -D weft-testing
```

---

## What's in it

### Deterministic providers

Replace OpenAI/Anthropic/Google in tests with a deterministic provider that returns whatever you tell it to.

```typescript
import { describe, it, expect } from "vitest";
import { AgentUnit, createContext, configureProvider } from "weft-core";
import { createMockProvider } from "weft-testing";

it("summariser handles empty input", async () => {
  configureProvider(createMockProvider({ respond: () => "empty input" }));

  const result = await AgentUnit.of("")
    .ask("summarise")
    .run(createContext());

  expect(result.value).toBe("empty input");
});
```

### Rehearsal — record once, replay many

Capture a real run as a trace. Replay it deterministically in CI without any API calls.

```typescript
import { TraceRecorder, TraceReplayer } from "weft-testing";

// Recording phase (one time, against real providers)
const recorder = new TraceRecorder();
const live = await unit.rehearse(recorder.options).run(ctx);
writeFileSync("trace.json", JSON.stringify(live.value.trace));

// Replay phase (CI, deterministic, free)
const trace = JSON.parse(readFileSync("trace.json", "utf8"));
const replayed = await unit.replay(trace).run(ctx);
expect(replayed.value.divergences).toHaveLength(0);
```

### Chaos injection

Inject failures, timeouts, slow responses, partial outputs into a recorded trace to test resilience operators.

```typescript
import { injectChaos } from "weft-testing";

const flaky = injectChaos(trace, { failRate: 0.3, timeoutMs: 5000 });
const result = await unit.retry(3).timeout(10_000).replay(flaky).run(ctx);
```

### Property-based fixtures

Pre-built fixtures for the common shapes — votes, consensus results, debate rounds, dialectic outputs — so tests don't drown in boilerplate.

```typescript
import { createVote, createConsensusInput } from "weft-testing";

const votes = [
  createVote({ decision: "accept", confidence: 0.9 }),
  createVote({ decision: "accept", confidence: 0.6 }),
  createVote({ decision: "reject", confidence: 0.8 }),
];
```

---

## Why this exists

LLM tests are slow, expensive, and flaky if you let them hit real APIs in CI. The rehearsal pattern (record once, replay forever) plus deterministic providers plus property-based fixtures is the only way to test agent compositions seriously. This package is the toolbox.

---

## License

MIT
