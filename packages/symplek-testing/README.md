# @symplek/testing

Record-and-replay harness for Symplek agent compositions. Capture a real run as a trace, replay it deterministically in CI, and assert that outputs did not diverge: without hitting real LLM APIs.

**Pre-1.0. The API will move.**

> `@symplek/testing` is a re-export shell. All logic lives in `@symplek/core/rehearsal`.
> Import from `@symplek/testing` for the stable public entry point; import from
> `@symplek/core/rehearsal` directly if you need the full internal surface.

---

## Install

```bash
pnpm add -D @symplek/testing
pnpm add @symplek/core       # peer dependency
```

---

## What's in it

`@symplek/testing` re-exports everything from `@symplek/core/rehearsal`. The primary exports are:

| Export | Kind | Purpose |
|---|---|---|
| `TraceRecorder` | class | Low-level: manually record trace events |
| `TraceReplayer` | class | Low-level: replay an `ExecutionTrace` |
| `TestHarness` | class | High-level: run + assert in one call |
| `createTestHarness` | function | Factory for `TestHarness` |
| `TraceVersionError` | class | Thrown when a trace was recorded on an incompatible schema version |
| `ReplayDivergenceError` | class | Thrown when replayed outputs diverge from the recording |
| `DeterminismError` | class | Thrown by determinism assertions |

---

## Rehearsal pattern: record once, replay many

The `.rehearse()` operator on `AgentUnit` records a run and returns the trace alongside the result. The `.replay(trace)` operator uses that trace to replay deterministically.

```typescript
import { writeFileSync, readFileSync } from "node:fs";
import { AgentUnit, createContext } from "@symplek/core";
import { ReplayDivergenceError } from "@symplek/testing";

const ctx = createContext();
const unit = AgentUnit.of("summarise this document");

// ── Recording (one time, against real providers) ──────────────────────────────
const recorded = await unit.rehearse().run(ctx);
//                          ^^^^^^^^^^^
//  rehearse() wraps the unit; the result shape is { value, trace }
writeFileSync("trace.json", JSON.stringify(recorded.value.trace));

// ── Replay (CI, deterministic, no API calls) ──────────────────────────────────
const raw = readFileSync("trace.json", "utf8");
const trace = JSON.parse(raw) as typeof recorded.value.trace;

const replayed = await unit.replay(trace).run(ctx);
//  replayed.value.divergences is empty when the output is identical
if (replayed.value.divergences.length > 0) {
  throw new ReplayDivergenceError("Output diverged from recording", replayed.value.divergences);
}
```

### `rehearse()` options

```typescript
unit.rehearse({
  includePrompts: true,           // store raw LLM prompt text in the trace
  redactPatterns: [/Bearer \S+/], // redact secrets before storing
})
```

---

## TestHarness: higher-level helper

`TestHarness` and `createTestHarness` wrap the record/replay cycle and expose assertion helpers:

```typescript
import { createTestHarness } from "@symplek/testing";
import { AgentUnit, createContext } from "@symplek/core";

const harness = createTestHarness();
const ctx = createContext();
const unit = AgentUnit.of("describe the image");

const result = await harness.run(unit, ctx);
//  result.trace   : the recorded ExecutionTrace
//  result.value   : the agent's output value
//  result.elapsed : wall-clock duration in ms
```

---

## Why this exists

LLM tests are slow, expensive, and flaky when they hit real APIs in CI. The rehearsal pattern (record once, replay forever) is the only way to test agent compositions seriously without either mocking the LLM layer or paying for every CI run. This package is the entry point to that toolbox.

---

## License

MIT
