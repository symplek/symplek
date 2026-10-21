# @symplek/react

React bindings for Symplek.

> **Support tier:** experimental (`0.1.0`)
>
> The root package surface is intentionally small. Only symbols exported from
> `@symplek/react` itself are part of the public contract.

## Root Exports

The package root currently exports:

| Export | Kind | Purpose |
|---|---|---|
| `AIErrorBoundary` | component | Catches rendering errors in Symplek-powered UI. |
| `AIProvider` | component | Provides client-side Symplek config via React context. |
| `useAIConfig` | hook | Reads the current `AIProvider` config. |
| `useAgent` | hook | Runs a single `AgentUnit` and tracks state. |
| `useConsensus` | hook | Runs Symplek consensus voting from React. |
| `useSwarm` | hook | Runs multiple `AgentUnit`s in parallel from React. |

These exports are verified against the real package entrypoint:

```bash
pnpm --dir packages/symplek-react run typecheck:boundary
pnpm --dir packages/symplek-react run test:contract
```

## Not Exported From Root

The following source files exist but are **not** public root exports:

| Hook | Status |
|---|---|
| `useAI` | Source-only. Do not import from `@symplek/react`. |
| `useAIQuery` | Source-only. Do not import from `@symplek/react`. |
| `useAIStream` | Source-only. Do not import from `@symplek/react`. |

If you need the supported surface, import only from `@symplek/react`.

## Example

```tsx
import { AgentUnit } from "@symplek/core";
import {
  AIErrorBoundary,
  AIProvider,
  useAgent,
} from "@symplek/react";

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

- `@symplek/core`
- `react`
- `react-dom`

## License

MIT
