# Symplek Framework — Architecture Overview

## Canonical Source and Distribution Mirror

Symplek has two codebases that serve different audiences:

| Layer | Path | Role |
|---|---|---|
| Canonical source | `convex/lib/agent_framework/` | Authoritative implementation; runs in the ProSentinel Convex app |
| Distribution mirror | `packages/@symplek/*` | npm packages extracted from the canonical source for external consumers |

**`convex/lib/agent_framework/` is the canonical Symplek source.** All core feature work, production bug fixes, and architectural changes originate here. The `packages/` directory contains distribution mirrors — environment-agnostic TypeScript re-exports built from the canonical source and published to npm.

## Why a separate mirror?

The Convex runtime uses a custom module resolver that cannot be consumed by standard Node.js bundlers or `npm install`. The `packages/` mirror re-exports the same logic through portable TypeScript that any consumer can import without Convex. This lets external contributors work in `packages/` with only Node.js and `pnpm` — no Convex account or cloud setup required.

## How the two codebases differ

`convex/lib/agent_framework/` includes Convex-specific features: governed actions tied to the Convex scheduler, query-side observability integrations, and runtime guards specific to Convex's V8 environment. The `packages/` mirror strips those runtime-specific bindings and exposes only the environment-agnostic core.

| Feature | `convex/lib/agent_framework/` | `packages/@symplek/*` |
|---|---|---|
| AgentUnit and operators | Full production set | Core portable set |
| Convex scheduler integration | Yes (`ctx.scheduler`) | No (use your own runtime) |
| Symplek facades (design/review/research) | Full | Subset in `@symplek/core` |
| React hooks | No | `@symplek/react` |
| CLI tooling | No | `@symplek/cli` |

## Package structure

| Package | License | Description |
|---|---|---|
| `@symplek/core` | MIT | Core `AgentUnit`, composition operators, and basic observability — free forever |
| `@symplek/pro` | BSL 1.1 | Organisational features: TaCo, trust registry, antibodies |
| `@symplek/react` | MIT | React bindings (`useAgent`, `useConsensus`, `useSwarm`, `AIProvider`, `useAIConfig`, `AIErrorBoundary`) |
| `@symplek/convex` | MIT | Convex bindings — wraps `@symplek/core/server` for Convex actions |
| `@symplek/cli` | MIT | The `symplek` command: `init`, `add`, `validate`, `generate`, `migrate` |
| `create-symplek` | MIT | Wrapper that runs `symplek init`. Held back from release |
| `@symplek/mcp` | MIT | MCP client with trust policies, plus a stdio demo server whose debate and consensus tools run on stub agents |
| `@symplek/harness` | MIT | Plan, permission-gate and execute operators for agent sessions. Pre-alpha: no agent SDK is wired yet |
| `@symplek/devtools` | MIT | Chrome DevTools extension bridge for agent observability (private, not published) |
| `@symplek/testing` | MIT | Re-exports the record and replay engine from `@symplek/core/rehearsal` |

## Shared concepts

These concepts exist in both the canonical source and the distribution mirror. When modifying them, update **both** locations and keep field shapes aligned.

| Concept | Canonical source | Distribution mirror | Notes |
|---|---|---|---|
| AgentUnit | `algebra/core/AgentUnit.ts` | `@symplek/core/src/AgentUnit.ts` | Core shared contract. See asymmetries below. |
| AgentUnitMetadata | `algebra/core/types/agent.types.ts` | `@symplek/core/src/AgentUnit.ts` | Metadata interface — paths differ; keep field shapes aligned. |
| SymplekError | `core/weftErrors.ts` | `@symplek/core/src/errors.ts` | **Error codes diverge intentionally.** Only `TIMEOUT` is shared. Canonical codes are Convex-oriented (`CIRCUIT_OPEN`, `IDEMPOTENCY_CONFLICT`, etc.); mirror codes are package-oriented (`AUTH_FAILED`, `NETWORK_ERROR`, etc.). Constructor signatures also differ — canonical requires `{ code, why, fix }`; mirror accepts a richer optional object. |
| SymplekBuilder | `symplek/facades/shared.ts` | `@symplek/core/src/builder.ts` | **Nearly unrelated.** Canonical is a production Convex facade with `.prompt()`, `.withFallback()`, `.withBudget()`, `.runStream()`, `.structured()`; mirror is a simple lazy wrapper with `.coordinate()`, its deprecated alias `.toUnit()`, `.run()` and `.then()` (PromiseLike). Only `.toUnit()` is aligned across the two. |
| RetryOptions | `symplek/core/validation.ts` | `@symplek/core/src/types.ts` | **Distinct types serving different mechanisms.** Canonical: `{ maxRetries?, baseDelayMs?, originalPrompt? }` for LLM schema-validation retry-with-feedback. Mirror: `{ maxAttempts?, baseDelayMs?, maxDelayMs?, jitter?, retryIf? }` for the AgentUnit `.retry()` operator. `maxRetries` vs `maxAttempts` is the easiest copy-paste trap during manual sync. |

### Known asymmetries (not shared — per-side only)

| Concept | Location | Notes |
|---|---|---|
| `AgentUnit.fromAgent()` | Canonical only (`convex/lib/agent_framework/`) | Takes a Convex `AgentExecutor` tied to the runtime. No mirror equivalent. |
| `AgentUnit.fromWithFallback()` | Mirror only (`@symplek/core`) | Quality-of-life addition not yet backported to canonical. |
| `TrackedResult<T>` | Mirror only (`@symplek/core/src/types.ts`) | Zero-trust provenance wrapper returned by default from `.run()`. Canonical returns raw `T`. |
| `createContext()` | Mirror only (`@symplek/core/src/context.ts`) | Utility factory. Convex actions receive context from the Convex runtime, so canonical has no equivalent factory. |
| `WeftErrorEnvelope` + `toEnvelope()` | Canonical only | Serialization envelope type. Mirror uses `toJSON()` → `SerializedError` instead. |
| `facadeMethodRegistry`, `registerFacadeMethods`, `getFacadeMethodMetadata` | Canonical only | Convex-internal observability hooks. |
| `SymplekError.sanitizeContext()` static | Mirror only | Redacts api keys / tokens / passwords from context objects. No canonical equivalent. |

Equivalence between the two sides is guarded by the canonical ↔ mirror contract tests at `packages/symplek-core/src/__tests__/canonicalMirrorContract.test.ts`. Those tests need the canonical source on disk, so they run upstream only. In this repo the whole file skips itself.

## Sync and backport process

Sync is **manual and per-release** — there is no automated sync enforcement between the two codebases.

**Maintainer release flow** (canonical → packages):
1. Feature or fix lands in `convex/lib/agent_framework/`.
2. On each release cycle, maintainers extract the portable subset and update `packages/`.
3. `packages/@symplek/*` versions are bumped via Changesets and published to npm.

**External contributor flow** (packages → canonical backport):
1. External contributors open PRs targeting `packages/`.
2. Maintainers review and merge.
3. If the change also benefits the ProSentinel app, maintainers backport it to `convex/lib/agent_framework/` manually on the next release cycle.
4. Note "backport candidate" in your PR description to help maintainers triage.

## Import rules

The Convex bundler cannot resolve `@symplek/core` workspace packages. Always use relative imports inside `convex/`.

```typescript
// In convex/ files (canonical source):
import { AgentUnit } from "../../lib/agent_framework/algebra";
import { WeftError } from "../../lib/agent_framework/core/weftErrors";

// Never in convex/ files (fails at Convex bundler):
import { AgentUnit } from "@symplek/core";

// In packages/ or external consumers (distribution mirror):
import { AgentUnit } from "@symplek/core";
import { ai } from "@symplek/core/server";

// In React components:
import { AIErrorBoundary } from "@symplek/react";
import type { SymplekErrorDetail } from "@symplek/core";
```

Nothing in this repo enforces that rule: there is no `convex/` directory here. The `tier-boundary` CI job in this repo checks something else, that `packages/symplek-core/src` does not import `@symplek/pro`.

## Which API to use

| You are writing... | Use this |
|---|---|
| A Convex action in `convex/agents/` | `convex/lib/agent_framework` (canonical) |
| A Convex query/mutation | `convex/lib/agent_framework` (types only) |
| An external package or CLI tool | `@symplek/core` / `@symplek/core/server` |
| A React component consuming Symplek | `@symplek/react` + `@symplek/core` types |
| Middleware for Convex actions | `@symplek/convex` (wraps `@symplek/core/server`) |
