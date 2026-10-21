# Architecture

> Keep thin. This doc names things and describes their relationships. Derivable facts are generated, never restated here: env var names live in `docs/generated/`, and the design token table lives in the GENERATED blocks of `docs/DESIGN.md`. This app has no routes, no backend functions and no schema, so those generated files do not exist.
> Verified against symplek-workspace @ a9c2894 on 2026-09-29: every path, symbol and test below resolved in the live code.
> Source: this file replaces the record/replay note that used to sit at this path (the durable content is the "Flow 3" paragraph and the rehearsal lines of the code map; the original text is preserved in git history as blob aa2aa41). `docs/ARCHITECTURE-FULL.md` (canonical/mirror model) and `docs/tier-boundary.md` (tier split) are older docs reconciled below; they stay in place for the operator to retire.
> The cross-cutting table is the registry of approved patterns: one per concern. A second solution to a concern that has a row here is drift.

## Bird's-eye view

Symplek is a pnpm monorepo of ten independently versioned TypeScript packages (`packages/`), nine published and one private (`@symplek/devtools`). Its centre is `@symplek/core`: `AgentUnit<T>`, a lazy immutable monad whose operators (retry, timeout, fallback, consensus, debate, solo, loop, rehearse, replay) chain into one composed agent, run with `.run(ctx)` and return a provenance-carrying `TrackedResult<T>`. Everything else is a layer on that core: a paid tier (`@symplek/pro`), bindings for React and Convex, an MCP server, an agent-SDK trust harness, testing utilities, a CLI and a Chrome DevTools panel. There is no server and no database here; consumers embed the libraries. This repository is the public distribution mirror of a private application-side source (DEC-004): the canonical source directory `convex/lib/agent_framework/` does not exist in this repo.

## Context: external systems and trust boundaries

| System | Role | Trust |
|--------|------|-------|
| LLM providers (Anthropic, OpenAI, Google) | Text and tool-call generation behind the `Provider` interface | External-untrusted output |
| Vendor agent SDKs (`@anthropic-ai/claude-agent-sdk`, `openai`) | Optional peers of `@symplek/harness`; the harness never loads a real session today (DEC-013) | External-untrusted output |
| MCP servers | Tool sources consumed by `@symplek/mcp` over stdio | External-untrusted output |
| MCP clients (Claude Code, Cursor) | Call the `@symplek/mcp` stdio server | Untrusted (client) |
| Host web page | Posts bridge messages the DevTools content script listens for | Untrusted (client) |
| npm registry, GitHub Actions | Release path (changesets) | External-trusted |

Inbound entry points: the `symplek` and `create-symplek` executables, the `@symplek/mcp` stdio server, and library imports. There is no HTTP surface.

## Containers

- `@symplek/core` (MIT, `packages/symplek-core`): the algebra, providers, rehearsal engine, durable store, solo, interview, change-kernel, confidence, coherence and teams. Runtime peers are `zod` (required) plus optional `openai`, `@anthropic-ai/sdk`, `@google/generative-ai` and `@opentelemetry/*`. Built by `tsup` to eleven entry points.
- `@symplek/pro` (BUSL-1.1, `packages/symplek-pro`): TaCo consensus, stigmergy, antibodies, trust lanes; re-exports core modules behind an import-time license gate. Peer `@symplek/core`.
- `@symplek/react` (MIT): hooks and an error boundary for React 18/19. Peers `react`, `react-dom`, `@symplek/core`.
- `@symplek/convex` (MIT): `withAI(ctx)` wrapper and middleware for Convex actions. Peers `@symplek/core`, `convex`, `zod`.
- `@symplek/mcp` (MIT): Symplek operators as MCP tools (stdio JSON-RPC) plus a trust-aware MCP client.
- `@symplek/harness` (MIT, alpha): plan, approve and execute loop around agent SDKs, with replay assertions.
- `@symplek/testing` (MIT): a re-export shell over `@symplek/core/rehearsal`.
- `@symplek/cli` and `create-symplek` (MIT): scaffolding CLI (commander, inquirer, chokidar, ajv, js-yaml, glob, chalk, ora) and its `npm create` wrapper.
- `@symplek/devtools` (private, not published): Chrome MV3 extension built with Vite, React 19, reactflow, dagre, idb, lucide-react.
- Dependency direction (all of it): `@symplek/pro`, `@symplek/react`, `@symplek/convex`, `@symplek/mcp`, `@symplek/harness`, `@symplek/testing`, `@symplek/cli` depend on `@symplek/core`; no package declares a dependency on `@symplek/pro`, but `@symplek/harness` attempts an optional runtime `import("@symplek/pro")` in `packages/symplek-harness/src/operators/plan.ts` and falls back when it is absent; `create-symplek` shells out to `@symplek/cli`; `@symplek/devtools` imports no `@symplek/*` package.

## Code map (every name resolves; the anchor checker verifies)

- Composition core: `packages/symplek-core/src/AgentUnit/AgentUnit.ts`, `packages/symplek-core/src/AgentUnit/operators/index.ts`, `packages/symplek-core/src/AgentUnit/zeroTrust.ts`, `packages/symplek-core/src/AgentUnit/metadata.ts`
- Operator factories (free tier): `packages/symplek-core/src/operators/consensus.ts`, `packages/symplek-core/src/operators/converge.ts`, `packages/symplek-core/src/operators/debate.ts`, `packages/symplek-core/src/operators/dialectic.ts`, `packages/symplek-core/src/operators/solo.ts`
- Provenance and errors: `packages/symplek-core/src/trust.ts`, `packages/symplek-core/src/errors.ts`, `packages/symplek-core/src/contract.ts`
- Public barrels: `packages/symplek-core/src/index.ts`, `packages/symplek-core/src/server.ts`, `packages/symplek-core/src/agent/index.ts`
- One-call AI facade: `packages/symplek-core/src/facade.ts`, `packages/symplek-core/src/builder.ts`, `packages/symplek-core/src/ai.ts`, `packages/symplek-core/src/globalConfig.ts`
- Providers: `packages/symplek-core/src/providers/interface.ts`, `packages/symplek-core/src/providers/registry.ts`, `packages/symplek-core/src/providers/auto.ts`, `packages/symplek-core/src/providers/anthropic.ts`, `packages/symplek-core/src/providers/openai.ts`, `packages/symplek-core/src/providers/google.ts`, `packages/symplek-core/src/providers/redact.ts`
- Tool loop: `packages/symplek-core/src/agent/executor.ts`, `packages/symplek-core/src/agent/tool.ts`, `packages/symplek-core/src/AgentUnit/operators/loop.ts`
- Record and replay: `packages/symplek-core/src/rehearsal/recorder.ts`, `packages/symplek-core/src/rehearsal/replayer.ts`, `packages/symplek-core/src/rehearsal/interceptor.ts`, `packages/symplek-core/src/rehearsal/golden.ts`, `packages/symplek-core/src/rehearsal/storage.ts`, `packages/symplek-core/src/AgentUnit/operators/rehearsal.ts`
- Durable execution: `packages/symplek-core/src/idempotency.ts`, `packages/symplek-core/src/store/backend.ts`, `packages/symplek-core/src/store/factory.ts`, `packages/symplek-core/src/store/resume.ts`
- Autonomy and governance: `packages/symplek-core/src/solo/decision.ts`, `packages/symplek-core/src/solo/lock.ts`, `packages/symplek-core/src/change-kernel/index.ts`, `packages/symplek-core/src/interview/Interview.ts`, `packages/symplek-core/src/teams/Team.ts`
- Scoring: `packages/symplek-core/src/confidence/index.ts`, `packages/symplek-core/src/coherence/index.ts`, `packages/symplek-core/src/uncertainty/index.ts`
- Observability: `packages/symplek-core/src/observability.ts`, `packages/symplek-core/src/trace.ts`, `packages/symplek-core/src/otel.ts`
- Pro tier: `packages/symplek-pro/src/license-gate.ts`, `packages/symplek-pro/src/taco.ts`, `packages/symplek-pro/src/stigmergy.ts`, `packages/symplek-pro/src/antibodies.ts`, `packages/symplek-pro/src/trust.ts`
- React binding: `packages/symplek-react/src/index.ts`, `packages/symplek-react/src/hooks/useAgent.ts`, `packages/symplek-react/src/AIErrorBoundary.tsx`
- Convex binding: `packages/symplek-convex/src/withAI.ts`, `packages/symplek-convex/src/middleware.ts`
- MCP: `packages/symplek-mcp/src/server/index.ts`, `packages/symplek-mcp/src/server/validateInput.ts`, `packages/symplek-mcp/src/MCPUnit.ts`, `packages/symplek-mcp/src/policies/TrustPolicyEngine.ts`, `packages/symplek-mcp/src/client/MCPRegistry.ts`
- Harness: `packages/symplek-harness/src/adapter/claude-agent-sdk.ts`, `packages/symplek-harness/src/operators/plan.ts`, `packages/symplek-harness/src/operators/execute.ts`, `packages/symplek-harness/src/permission-bridge.ts`
- CLI: `packages/symplek-cli/src/cli.ts`, `packages/symplek-cli/src/index.ts`, `packages/create-symplek/src/index.ts`
- DevTools extension: `packages/symplek-devtools/manifest.json`, `packages/symplek-devtools/src/content/bridge-listener.ts`, `packages/symplek-devtools/src/background/relay.ts`, `packages/symplek-devtools/src/panel/DevToolsPanel.tsx`
- Release and CI: `.github/workflows/ci.yml`, `.changeset/config.json`, `pnpm-workspace.yaml`, `biome.json`

## Boundaries and dependency direction

- `@symplek/core` never imports `@symplek/pro` (DEC-003, INV-001). Enforced by the `tier-boundary` CI job, which greps for import statements only; no local test holds it.
- The `@symplek/core` root barrel is browser-safe. Provider SDKs and the `Symplek`, `SymplekBuilder`, `ProviderRegistry` and `providerRegistry` symbols are reachable only from `@symplek/core/server` (DEC-007, INV-002).
- Operators are attached by prototype augmentation, so `AgentUnit` must be imported from the `@symplek/core` barrel, never from an internal path (DEC-005, INV-006).
- Packages consume `@symplek/core` only through its published entry points (`@symplek/core`, `@symplek/core/server`, and the subpaths in `packages/symplek-core/package.json`), never by relative path.
- `@symplek/react` exposes only hooks that run in the browser; the server-bound hooks stay out of its barrel (DEC-011).
- `@symplek/testing` holds no logic: it re-exports `@symplek/core/rehearsal` (DEC-014).

## Key runtime flows (anchored to entry points)

**Flow 1: compose and run.** `AgentUnit.from` (or `of`, `fromPromise`) wraps a computation lazily; each operator returns a new unit with an extended `operatorChain`; `run(ctx)` checks the operator augmentation is loaded, resolves an optional idempotency slot, executes the computation and wraps the value with `wrapInTrackedResult` into a `TrackedResult` (zero-trust default) or returns the raw value (`trustMode: "legacy"`, deprecated). Errors pass through `handleError` in `packages/symplek-core/src/AgentUnit/errorEnhancement.ts`.
  Entry: `packages/symplek-core/src/AgentUnit/AgentUnit.ts`, `packages/symplek-core/src/index.ts`

**Flow 2: one-call AI.** `Symplek(task)` returns a lazy `SymplekBuilder` (a `PromiseLike`); awaiting it or calling `.coordinate()` builds an `AgentUnit` around `ai()`, optionally wrapped with `provides(schema)`, `timeout` and `retry`. `ai()` awaits the pending `Symplek.configure` bootstrap, picks a provider with `detectProvider` (registry default, then the OpenAI, Anthropic and Google keys in that order; names in `docs/generated/env-vars.md`), calls the `Provider` and records a `Trace` in `traceManager`.
  Entry: `packages/symplek-core/src/facade.ts`, `packages/symplek-core/src/server.ts`

**Flow 3: record and replay.** `unit.rehearse()` runs the composed computation inside a `TraceRecorder`, which stamps events with vector clocks (`VectorClockManager`) and DJB2 hashes, snapshots state through `CheckpointManager`, and builds the `ExecutionTrace` in `finalize`. `FileStorage` persists it; `toGoldenTrace` turns it into a committed test oracle with a SHA-256 output hash and default secret redaction. `unit.replay(trace)` builds a `TraceReplayer` that orders events with `DependencyScheduler`, verifies hashes and reports `Divergence` entries without running the agent body. `replayAgentWithTrace` instead executes the factory with a `ReplayLLMInterceptor` injected through `AgentContext.extensions`. Provider calls are not intercepted automatically: only agents that call the interceptor avoid live calls (DEC-009).
  Entry: `packages/symplek-core/src/AgentUnit/operators/rehearsal.ts`, `packages/symplek-core/src/rehearsal/index.ts`

**Flow 4: tool loop.** `unit.loop(options)` calls `executeLoop`, which alternates provider generation and tool execution, parses tool input with the tool's Zod schema, and routes any tool marked `requiresApproval` through the approval callback before it runs. The older `executeAgent` behind `ai.agent` never executes tools (DEC-012).
  Entry: `packages/symplek-core/src/AgentUnit/operators/loop.ts`, `packages/symplek-core/src/agent/index.ts`

**Flow 5: durable run.** `createDurableStore(backend)` turns one four-method KV `DurableStoreBackend` into an idempotency store and a session-local transaction log; `run(ctx, { idempotency })` executes once per key, and `resume` re-runs a unit with the run id as the key so a committed run returns its cached result (DEC-010).
  Entry: `packages/symplek-core/src/store/index.ts`

**Flow 6: MCP server.** The `@symplek/mcp` binary starts `startSymplekMcpServer`, a hand-rolled stdio JSON-RPC loop answering `initialize`, `tools/list` and `tools/call`; each call is validated by `validateInput` against the tool's `inputSchema`, then dispatched to `debateTool`, `consensusTool` or `trackedTool`.
  Entry: `packages/symplek-mcp/src/server/bin.ts`, `packages/symplek-mcp/src/server/index.ts`

## Cross-cutting concepts (approved pattern for each)

| Concept | Approved pattern | Where to look |
|---------|------------------|---------------|
| Result provenance | `createTrackedResult` is the only constructor; `isTrackedResult` checks a module-private WeakSet. No hand-built TrackedResult. | DEC-006, INV-004, `packages/symplek-core/src/trust.ts` |
| Errors | `SymplekError` with a code and fix guidance for package failures. Domain errors (`ContractError`, `CoherenceError`, `ReplayDivergenceError`, `MCPCallError`) extend `Error` directly. | `packages/symplek-core/src/errors.ts` |
| LLM access | The `Provider` interface plus `providerRegistry`. No vendor SDK call outside `packages/symplek-core/src/providers/`. | DEC-008, `packages/symplek-core/src/providers/registry.ts` |
| Resilience | `.retry`, `.timeout`, `.fallback`, `.orElse` operators. No hand-written retry loops around a unit. | `packages/symplek-core/src/AgentUnit/operators/resilience.ts` |
| Side-effect dedupe | `run(ctx, { idempotency })` with an `IdempotencyStore`; durable variant from `createDurableStore`. | DEC-010, INV-005, `packages/symplek-core/src/idempotency.ts` |
| Human approval | `interview` and `conduct` for Q and A, `supervised` for oversight, `requiresApproval` on a `tool()` for tool gates. | `packages/symplek-core/src/interview/computations.ts`, `packages/symplek-core/src/AgentUnit/operators/supervised.ts` |
| Secret redaction | Provider errors through `redactErrorMessage`; traces through `ai.setRedactor`; golden traces through `DEFAULT_SECRET_PATTERNS`. | INV-007, INV-008, `packages/symplek-core/src/providers/redact.ts` |
| Tracing | Three separate stores with different jobs: `traceManager` (per-`ai()` call), `observable` spans (per-operator, `getTraces`), and rehearsal `ExecutionTrace` (replayable). Do not add a fourth. | `packages/symplek-core/src/trace.ts`, `packages/symplek-core/src/observability.ts` |
| Process-wide state | Module singletons: `providerRegistry`, `globalConfig`, `traceManager`, `defaultIdempotencyStore`, `defaultLockManager`. Tests reset them explicitly. | `packages/symplek-core/src/globalConfig.ts` |
| Workspace versioning | Changesets with linked groups (`@symplek/core` and `@symplek/pro`; `create-symplek` and `@symplek/cli`). No manual version edits. | DEC-002, `.changeset/config.json` |
| Configuration | Env names are in `docs/generated/env-vars.md`; provider keys are read for detection only in `packages/symplek-core/src/providers/auto.ts` and `packages/symplek-core/src/facade.ts`. | `docs/generated/env-vars.md` |

## Placement rules (where new code goes)

- A new composition operator: an `AgentUnit` prototype file under `packages/symplek-core/src/AgentUnit/operators/` (register it in `index.ts` there and add its signature to the merged interface in `AgentUnit.ts`), with the pure factory under `packages/symplek-core/src/operators/`.
- A developer primitive is free-tier and goes in `@symplek/core`; team, governance and advanced-observability features go in `@symplek/pro` (DEC-003).
- A new LLM vendor: an adapter implementing `Provider` under `packages/symplek-core/src/providers/`, registered in `providers/registry.ts`.
- A heavier optional module: its own directory with an `index.ts`, a subpath in `packages/symplek-core/package.json` `exports`, and an entry in the `tsup` build script.
- A new persistence backend: implement `DurableStoreBackend` in a downstream package; only the file backend ships in core.
- A framework binding: a new `@symplek/*` package depending on `@symplek/core` as a peer.
- Tests sit in a `__tests__` directory beside the code, run by `vitest`.

"Looks wrong but is deliberate":

- `packages/symplek-pro/src/solo/` and other `@symplek/pro` submodules are re-export shells over `@symplek/core`; the implementation lives once, in core (DEC-003).
- `packages/symplek-testing/src/rehearsal/` files are re-export shells kept so old import paths resolve (DEC-014).
- Free-tier operators (`dialectic`, `debate`, `solo`, `coherence`) are instance methods; only standalone factory functions such as `tacoConsensus` are pro.
- Mirror-only additions, kept on purpose (DEC-004): `AgentUnit.fromWithFallback`, `createContext`, `SymplekError.sanitizeContext` and `toJSON`, and `TrackedResult` returned by default. `RetryOptions` here uses `maxAttempts`, `baseDelayMs`, `maxDelayMs`, `jitter` and `retryIf`; the older canonical source used other names, so `maxRetries` versus `maxAttempts` is the copy-paste trap during manual sync. The canonical side cannot be inspected from this repo; those claims come from `docs/ARCHITECTURE-FULL.md`.
- `SymplekError` codes and the `SymplekBuilder` surface intentionally differ from the private canonical source; do not align them.
- `packages/symplek-core/src/types.ts` is over the 1000-line ceiling; it is a known exception awaiting a split.
- Files begin with `@rules` header comments naming rule files that live in the framework, not in this repo.

## Deploy and environments

There is no deployed environment. Local: `pnpm build`, `pnpm test`, `pnpm lint`, `pnpm typecheck` from the root. Ship: `.github/workflows/ci.yml` runs lint, typecheck, the `tier-boundary` job, build, test and, on `main`, the changesets release. Env var names are in `docs/generated/env-vars.md`; never list them here.
