# weft-testing

Record-and-replay helpers for Weft agent compositions. Capture the outcome of a real run as a trace, then hand that outcome back in tests with no model call.

**Pre-1.0. The API will move.**

> `weft-testing` is a re-export shell. All logic lives in `weft-core/rehearsal`.
> Import from `weft-testing` for the stable public entry point; import from
> `weft-core/rehearsal` directly if you need the full internal surface.

---

## Install

```bash
pnpm add -D weft-testing
pnpm add weft-core       # peer dependency
```

---

## What's in it

`weft-testing` re-exports everything from `weft-core/rehearsal`. The primary exports are:

| Export | Kind | Purpose |
|---|---|---|
| `TraceRecorder` | class | Low-level: record trace events yourself |
| `TraceReplayer` | class | Low-level: check an `ExecutionTrace` and return its stored output |
| `TestHarness` | class | Keeps recorded traces by name, replays them, and compares two runs |
| `createTestHarness` | function | Factory for `TestHarness` |
| `TraceVersionError` | class | Thrown when a trace was recorded on an incompatible schema version |
| `ReplayDivergenceError` | class | Thrown by replay when an event in the trace has been altered |
| `DeterminismError` | class | Thrown by `TestHarness.verify()` and `assertDeterministic()` when two results differ |

---

## Record once, replay many

`.rehearse()` on an `AgentUnit` runs it once and returns the result together with a trace. `.replay(trace)` checks the trace and hands the stored result back without running the unit.

```typescript
import { readFileSync, writeFileSync } from "node:fs";
import { AgentUnit, createContext } from "weft-core";

const ctx = createContext();
const unit = AgentUnit.of("summarise this document");

// Record, one time. The result shape is { value, trace }.
const recorded = await unit.rehearse().run(ctx);
writeFileSync("trace.json", JSON.stringify(recorded.value.trace));

// Replay, in CI. Nothing runs: the stored output comes back after its hashes are checked.
const trace = JSON.parse(readFileSync("trace.json", "utf8")) as typeof recorded.value.trace;
const replayed = await unit.replay(trace).run(ctx);

console.log(replayed.value.value);   // "summarise this document"
console.log(replayed.value.matched); // true
if (!replayed.value.matched) {
  const reasons = replayed.value.divergences.map((d) => d.description);
  throw new Error(`The trace was altered: ${reasons.join("; ")}`);
}
```

Know the limits before you lean on this. The trace holds the final output and its hash, not the model calls or steps inside the unit. Replay does not re-run your agent: `matched` tells you the trace is intact, not that today's code would still produce that output. The [root README](../../README.md#record-and-replay) spells out what is and is not recorded.

---

## TestHarness

`createTestHarness()` gives you one place to keep traces by name, replay them, and check that two runs of the same unit agree.

```typescript
import { AgentUnit, createContext } from "weft-core";
import { createTestHarness } from "weft-testing";

const harness = createTestHarness();
const ctx = createContext();
const unit = AgentUnit.of("describe the image");
const run = async () => (await unit.rehearse().run(ctx)).value;

// Record under a name, then replay the stored trace.
const golden = await harness.record(run, "describe");
const replayed = await harness.replay(golden.trace);
console.log(replayed.matched); // true

// Run the unit twice. Throws DeterminismError if the two outputs differ.
await harness.verify(run);
```

---

## Why this exists

Tests that call a real model are slow, cost money and fail for reasons that have nothing to do with your code. Recording a good run once and reusing its output lets the rest of your test exercise everything around the model call without paying for it again. This package is the entry point to that toolbox.

---

## License

MIT
