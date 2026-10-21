# @symplek/harness

Algebraic trust layer for AI agent SDKs. Wraps Claude Agent SDK and OpenAI agent calls in Symplek's `AgentUnit<T>` algebra so you get retries, timeouts, fallbacks, consensus, replay, and trace recording without rewriting the underlying agent code.

**Pre-1.0. The API will move.**

---

## Install

```bash
pnpm add @symplek/harness @symplek/core
```

Optional peers — install whichever vendor SDKs you actually use:

```bash
pnpm add @anthropic-ai/claude-agent-sdk   # for Claude
pnpm add openai                            # for OpenAI
pnpm add react                             # for the useHarnessProgress hook
```

---

## What it does

Most agent SDKs give you a single function: send a prompt, get a response. They don't compose. They don't retry intelligently. They don't replay. They don't let you run two agents in parallel and pick the winner.

`@symplek/harness` lifts agent calls into `AgentUnit<T>` so every Symplek operator works on them.

```typescript
import { createContext } from "@symplek/core";
import { createHarness } from "@symplek/harness";

const harness = createHarness({ adapter: "claude-agent-sdk", model: "claude-sonnet-4" });
const result = await harness.plan("summarise this PDF")
  .retry(2)
  .timeout(120_000)
  .run(createContext());
// result.value is a PlanArtifact — result.value.id is the SHA-256 plan ID.
```

---

## What's in the package

- `createHarness(options)` — Create a harness instance for planning and execution.
- `harness.plan(intent)` — Build a plan AgentUnit from an intent string.
- `harness.execute(planOrPrompt)` — Execute a plan or prompt.
- React entry at `@symplek/harness/react` — `useHarnessProgress()` hook for streaming progress UI.
- Replay entry at `@symplek/harness/replay` — Deterministic replay of recorded harness traces.

---

## Why this exists

You shouldn't have to choose between an agent SDK that runs and a trust layer that lets you reason about the agent's behaviour. The harness is the glue. Build with the SDK; reason with Symplek.

---

## License

MIT
