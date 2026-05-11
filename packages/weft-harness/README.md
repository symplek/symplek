# weft-harness

Algebraic trust layer for AI agent SDKs. Wraps Claude Agent SDK and OpenAI agent calls in Weft's `AgentUnit<T>` algebra so you get retries, timeouts, fallbacks, consensus, replay, and trace recording without rewriting the underlying agent code.

**Pre-1.0. The API will move.**

---

## Install

```bash
pnpm add weft-harness weft-core
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

`weft-harness` lifts agent calls into `AgentUnit<T>` so every Weft operator works on them.

```typescript
import { AgentUnit, createContext } from "weft-core";
import { plan, execute, session } from "weft-harness";

const ctx = createContext();

// Plan + execute, with retries + timeout + parallel race against a cheaper backup.
const result = await plan({ goal: "summarise this PDF", model: "claude-sonnet-4" })
  .pipe(p => execute(p))
  .retry(2)
  .timeout(30_000)
  .fallback(execute({ prompt: "fallback summariser", model: "gpt-4o-mini" }))
  .run(ctx);
```

---

## What's in the package

- `plan(options)` — Build a plan AgentUnit. Wraps `claude-agent-sdk` planning calls.
- `execute(planOrPrompt)` — Execute a plan. Wraps the relevant SDK's runtime.
- `session(config)` — Long-running conversational session. Captures full history.
- React entry at `weft-harness/react` — `useHarnessProgress()` hook for streaming progress UI.
- Replay entry at `weft-harness/replay` — Deterministic replay of recorded harness traces.

---

## Why this exists

You shouldn't have to choose between an agent SDK that runs and a trust layer that lets you reason about the agent's behaviour. The harness is the glue. Build with the SDK; reason with Weft.

---

## License

MIT
