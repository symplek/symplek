# Architecture

This doc explains how Weft is laid out, why some things look duplicated, and which asymmetries between the public packages and our internal canonical source are deliberate.

## Canonical and mirror

Weft has two codebases:

| Layer | Where | Role |
|---|---|---|
| Canonical source | A private upstream monorepo | Where Weft is developed day-to-day, alongside an application that consumes it. Not open-sourced. |
| Distribution mirror | This repo (`wefthq/weft`) | What gets published to npm under `@weft/*`. The source of truth for everything you can `pnpm add`. |

The canonical source uses a runtime-specific module resolver that cannot be consumed by standard Node.js bundlers. The mirror strips those runtime bindings and exposes only the environment-agnostic core, so any consumer can `pnpm add @weft/core` without bringing in our internal runtime.

Sync is **manual, per-release**. See [`SYNC.md`](../SYNC.md) at the repo root.

## Packages

| Package | Licence | What it does |
|---|---|---|
| `@weft/core` | MIT | `AgentUnit`, composition operators, basic observability, providers |
| `@weft/pro` | BSL 1.1 | TaCo consensus, antibodies, trust registry, dashboards |
| `@weft/react` | MIT | React hooks for streaming and error boundaries |
| `@weft/convex` | MIT | Convex bindings (wraps `@weft/core/server`) |
| `@weft/cli` | MIT | Scaffolding, debugging |
| `@weft/mcp` | MIT | MCP server exposing Weft as tool calls |
| `@weft/harness` | MIT | Replay / rehearse / fault-injection for tests |
| `@weft/devtools` | MIT | Trace and span inspection |
| `@weft/testing` | MIT | Vitest utilities, mock factories, deterministic providers |

## Shared concepts

Four concepts exist on both sides and are contract-tested:

| Concept | What it is |
|---|---|
| `AgentUnit` | The core algebra. Lazy, composable, typed. |
| `AgentUnitMetadata` | Provenance and config metadata on each unit. |
| `WeftError` | The error type. |
| `RetryOptions` | Config for the `.retry()` operator. |

Equivalence is enforced by `packages/weft-core/src/__tests__/canonicalMirrorContract.test.ts`. Failing those tests means sync has drifted.

## Deliberate asymmetries

These look like inconsistencies. They are not bugs. **Do not "fix" them in PRs.**

### `WeftError` codes diverge

The two sides use different error code vocabularies because they serve different runtimes:

- **Canonical** uses codes oriented around its runtime: `CIRCUIT_OPEN`, `IDEMPOTENCY_CONFLICT`, etc.
- **Mirror** uses codes oriented around external consumers: `AUTH_FAILED`, `NETWORK_ERROR`, etc.

Only `TIMEOUT` is shared. The constructor signatures also differ: canonical requires `{ code, why, fix }`; mirror accepts a richer optional shape.

### `WeftBuilder` is nearly unrelated

The canonical `WeftBuilder` is a production facade with `.prompt()`, `.withFallback()`, `.withBudget()`, `.runStream()`, `.structured()`. The mirror's is a simple lazy wrapper with `.toUnit()`, `.run()`, `.then()`. Only `.toUnit()` exists in both.

Why: the mirror builder exists to be tree-shakeable and runtime-free. The canonical builder leans on a runtime that mirror consumers don't have.

### `RetryOptions` shapes differ

- **Canonical:** `{ maxRetries?, baseDelayMs?, originalPrompt? }` — used for schema-validation retry-with-feedback inside LLM calls.
- **Mirror:** `{ maxAttempts?, baseDelayMs?, maxDelayMs?, jitter?, retryIf? }` — used for the general-purpose `.retry()` operator on `AgentUnit`.

`maxRetries` vs `maxAttempts` is the easy copy-paste trap during sync. Maintainers know.

### Mirror-only additions

- `TrackedResult<T>` — provenance envelope returned by default from `.run()`. The canonical side returns raw `T`.
- `createContext()` — a factory for synthesising `AgentContext` outside the canonical runtime.
- `WeftError.sanitizeContext()` — redacts secrets from error context. Not needed canonical-side because the runtime sanitises upstream.

### Canonical-only

- `AgentUnit.fromAgent()` — takes a runtime-bound executor with no mirror equivalent.
- `WeftErrorEnvelope` / `toEnvelope()` — serialisation for the canonical runtime; mirror uses `toJSON()` → `SerializedError`.
- Facade observability hooks — runtime-internal.

## Imports

```typescript
// External consumers — what you'll do:
import { AgentUnit, Weft } from "@weft/core/server";

// React components:
import { AIErrorBoundary } from "@weft/react";
import type { WeftErrorDetail } from "@weft/core";
```

`@weft/core` is browser-safe. `@weft/core/server` pulls in provider SDKs and is Node-only.

## Pre-1.0 stance

We're in 0.x. The shape will move. Specifically:

- New operators may be added at minor bumps.
- Existing operator names will not change without a deprecation path.
- The `TrackedResult` envelope shape may gain fields (additive) but won't lose them before 1.0.
- Provider adapters may be re-organised; the user-facing `Weft.configure({...})` shape is stable.

When in doubt, pin exact versions.
