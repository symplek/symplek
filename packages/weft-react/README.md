# weft-react

React bindings for Weft.

> **Support tier:** experimental (`0.1.0`)
>
> The root package surface is intentionally small. Only symbols exported from
> `weft-react` itself are part of the public contract.

## Root Exports

The package root currently exports:

| Export | Kind | Purpose |
|---|---|---|
| `AIErrorBoundary` | component | Catches rendering errors in Weft-powered UI. |
| `AIProvider` | component | Provides client-side Weft config via React context. |
| `useAIConfig` | hook | Reads the current `AIProvider` config. |
| `useAgent` | hook | Runs a single `AgentUnit` and tracks state. |
| `useConsensus` | hook | Runs Weft consensus voting from React. |
| `useSwarm` | hook | Runs multiple `AgentUnit`s in parallel from React. |

These exports are verified against the real package entrypoint:

```bash
pnpm --dir packages/weft-react run typecheck:boundary
pnpm --dir packages/weft-react run test:contract
```

## Not Exported From Root

The following source files exist but are **not** public root exports:

| Hook | Status |
|---|---|
| `useAI` | Source-only. Do not import from `weft-react`. |
| `useAIQuery` | Source-only. Do not import from `weft-react`. |
| `useAIStream` | Source-only. Do not import from `weft-react`. |

If you need the supported surface, import only from `weft-react`.

## Example

```tsx
import { AgentUnit } from "weft-core";
import {
  AIErrorBoundary,
  AIProvider,
  useAgent,
} from "weft-react";

function Greeting() {
  const { run, result, isRunning } = useAgent(AgentUnit.of("hello"));

  return (
    <div>
      <button onClick={() => void run()} type="button">
        Run agent
      </button>
      {isRunning ? <p>Running...</p> : <p>{result?.value ?? "Idle"}</p>}
    </div>
  );
}

export function App() {
  return (
    <AIErrorBoundary>
      <AIProvider config={{ defaultModel: "demo-model" }}>
        <Greeting />
      </AIProvider>
    </AIErrorBoundary>
  );
}
```

## Peer Dependencies

- `weft-core`
- `react`
- `react-dom`

## License

MIT
