# Journeys

> First-class drift anchor. Each journey is bound to its real entry points, the backend calls behind them, and the tests that prove it. When a journey's entry point changes, a new parallel path appears, or its proving test breaks, the anchor checker flags the section as stale.
>
> - Machine-readable anchor map: `docs/ANCHORS.json` (seeded by `node .claude/scripts/docs/canonical-docs.cjs seed-anchors`; checked at commit time by the doc drift gate).
> - Decisions and invariants cited here: `docs/DECISIONS.md` (DEC-nnn), `docs/INVARIANTS.md` (INV-nnn).
>
> **Notation.** This is a library monorepo with no routes and no backend functions. The callers are developers, so steps are written as public API calls (`Symbol.method`), CLI subcommands and MCP methods. Every named symbol and test file was resolved against the tree at a9c2894 on 2026-09-29.

## Journey A - Compose and run an agent (configure, build, chain, run)

**Success criterion:** a developer chains operators on a lazy `AgentUnit`, runs it with a context, and gets a `TrackedResult` whose value, source and confidence are readable.
**Cites:** DEC-005, DEC-006, DEC-007, DEC-008, INV-002, INV-003, INV-004.

| Step | Command or API | Handler | Note |
|------|----------------|---------|------|
| 1 | `Symplek.configure` | `packages/symplek-core/src/facade.ts` | optional; otherwise a provider key in the environment is detected |
| 2 | `AgentUnit.from`, `AgentUnit.of`, `Symplek` | `packages/symplek-core/src/AgentUnit/AgentUnit.ts`, `packages/symplek-core/src/builder.ts` | nothing executes yet |
| 3 | `.retry`, `.timeout`, `.consensus`, `.debate` | `packages/symplek-core/src/AgentUnit/operators/index.ts` | each returns a new unit |
| 4 | `.run` | `packages/symplek-core/src/AgentUnit/AgentUnit.ts` | `TrackedResult` by default; `trustMode: "legacy"` returns the raw value (deprecated) |

**Tests:**
- `packages/symplek-core/src/__tests__/golden-path.test.ts`: `from`, `map`, `run`, `zipAll`, `consensus`, `fromWithFallback`, `Symplek.configure` on the happy path.
- `packages/symplek-core/src/__tests__/facade.test.ts`: the `Symplek` namespace, `configure` obligations, provider detection.
- `packages/symplek-core/src/__tests__/tierBoundary.test.ts`: the free operators run without `@symplek/pro`.

## Journey B - Let an agent call tools, with a human gate

**Success criterion:** a unit runs a multi-turn model and tool exchange, and a tool marked `requiresApproval` runs only after the approval callback returns true.
**Cites:** DEC-008, DEC-012, INV-009.

| Step | Command or API | Handler | Note |
|------|----------------|---------|------|
| 1 | `tool` | `packages/symplek-core/src/agent/tool.ts` | Zod parameters; `name` required for the loop |
| 2 | `.loop` | `packages/symplek-core/src/AgentUnit/operators/loop.ts` | takes `tools`, `requireApproval`, `maxSteps` |
| 3 | `executeLoop` | `packages/symplek-core/src/agent/executor.ts` | provider generate, tool execute, repeat |
| 4 | `requireApproval` | `packages/symplek-core/src/agent/executor.ts` | denied calls return a refusal message to the model |

**Tests:**
- `packages/symplek-core/src/__tests__/tool-loop.test.ts`: multi-turn exchange, Zod parse before approval, no side effect without approval.
- `packages/symplek-core/src/providers/__tests__/anthropic-tool-loop.test.ts` and `packages/symplek-core/src/providers/__tests__/openai-tool-loop.test.ts`: provider tool-call round trips.

**Known drift:** `ai.agent` builds a second, tool-less agent (DEC-012). `executeLoop` defaults its model to a fixed Anthropic id whatever provider is active.

## Journey C - Record a run once, replay it in tests

**Success criterion:** a run recorded with `.rehearse()` is stored, committed as a golden trace with secrets redacted, and replayed in CI with matching output and a stated cost guarantee.
**Cites:** DEC-009, DEC-014, INV-008, INV-014.

| Step | Command or API | Handler | Note |
|------|----------------|---------|------|
| 1 | `.rehearse` | `packages/symplek-core/src/AgentUnit/operators/rehearsal.ts` | returns `{ value, trace }` |
| 2 | `FileStorage` | `packages/symplek-core/src/rehearsal/storage.ts` | persist and load traces |
| 3 | `toGoldenTrace` | `packages/symplek-core/src/rehearsal/golden.ts` | default credential redaction |
| 4 | `.replay`, `replayAgentWithTrace` | `packages/symplek-core/src/rehearsal/replayer.ts`, `packages/symplek-core/src/rehearsal/golden.ts` | zero-token only for agents that use the injected interceptor |
| 5 | `assertDeterministic`, `TestHarness` | `packages/symplek-core/src/rehearsal/testing.ts` | determinism gate; `@symplek/testing` re-exports all of it |

**Tests:**
- `packages/symplek-core/src/rehearsal/__tests__/integration.test.ts`: full record and replay cycle, checkpoints, storage.
- `packages/symplek-core/src/rehearsal/__tests__/golden.test.ts`: redaction, migration, the conditional zero-token guarantee.
- `packages/symplek-core/src/rehearsal/__tests__/integrity-defects.test.ts`: tampered output is detected.
- `packages/symplek-harness/src/__tests__/agent-unit-harness.test.ts`: interceptor injection for replay-based tests.

## Journey D - Make a run durable and resumable

**Success criterion:** a run keyed by an idempotency key executes once, survives a restart through a durable backend, and `resume` returns the cached result for a committed run.
**Cites:** DEC-006, DEC-010, INV-005, INV-015.

| Step | Command or API | Handler | Note |
|------|----------------|---------|------|
| 1 | `createFileBackend` | `packages/symplek-core/src/store/file-backend.ts` | the only backend that ships |
| 2 | `createDurableStore` | `packages/symplek-core/src/store/factory.ts` | idempotency store plus session-local transaction log |
| 3 | `.run` with `idempotency` | `packages/symplek-core/src/AgentUnit/AgentUnit.ts` | one execution per key; concurrent callers share one flight |
| 4 | `resume` | `packages/symplek-core/src/store/resume.ts` | whole-run cache hit only; sub-steps skip only with their own keys |

**Tests:**
- `packages/symplek-core/src/__tests__/store.test.ts`: serialisation, file backend, durable store, `resume`, case-aliasing.
- `packages/symplek-core/src/__tests__/idempotency.test.ts` and `packages/symplek-core/src/__tests__/idempotency-poisoning.test.ts`: single execution and rejection of a poisoned store.

## Journey E - Use Symplek inside a React or Convex app

**Success criterion:** a React component runs an `AgentUnit` through a hook and survives a render failure; a Convex action calls a model through `withAI` with scoped activity and cost logging.
**Cites:** DEC-007, DEC-011, INV-011.

| Step | Command or API | Handler | Note |
|------|----------------|---------|------|
| 1 | `AIProvider`, `useAIConfig` | `packages/symplek-react/src/AIProvider.tsx` | shared config |
| 2 | `useAgent`, `useConsensus`, `useSwarm` | `packages/symplek-react/src/hooks/useAgent.ts`, `packages/symplek-react/src/hooks/useConsensus.ts`, `packages/symplek-react/src/hooks/useSwarm.ts` | abort and unmount safe |
| 3 | `AIErrorBoundary` | `packages/symplek-react/src/AIErrorBoundary.tsx` | catches render failures, allows reset |
| 4 | `withAI` | `packages/symplek-convex/src/withAI.ts` | `generate`, `streamToMutation`, `raw` |

**Tests:**
- `packages/symplek-react/src/__tests__/integration.test.tsx`: provider, boundary reset, the three hooks from the root export.
- `packages/symplek-convex/src/__tests__/integration.test.ts`: the `withAI` main path, middleware and streaming.
- `packages/symplek-convex/src/__tests__/withAI-scoping.test.ts`: activity and cost scope are required.

**Known drift:** `README.md` and `docs/ARCHITECTURE-FULL.md` name a `useSymplekStream` hook that no package defines.

## Journey F - Call Symplek operators as MCP tools, or consume MCP tools with trust policies

**Success criterion:** an MCP client lists and calls `symplek_debate`, `symplek_consensus` and `symplek_tracked` over stdio with validated input; a Symplek agent calls an external MCP tool only after trust policies allow it.
**Cites:** DEC-016, INV-010.

| Step | Command or API | Handler | Note |
|------|----------------|---------|------|
| 1 | `@symplek/mcp` binary | `packages/symplek-mcp/src/server/bin.ts` | starts the server unconditionally |
| 2 | `initialize`, `tools/list`, `tools/call` | `packages/symplek-mcp/src/server/index.ts` | hand-rolled JSON-RPC over stdio |
| 3 | `validateInput` | `packages/symplek-mcp/src/server/validateInput.ts` | schema-subset check before dispatch |
| 4 | `MCPUnit.call` | `packages/symplek-mcp/src/MCPUnit.ts` | evidence wrapped, then `TrustPolicyEngine` verdict |

**Tests:**
- `packages/symplek-mcp/src/server/__tests__/server.test.ts`: the three tool handlers and the tool registry.
- `packages/symplek-mcp/src/server/__tests__/validateInput.adversarial.test.ts`: hostile arguments are rejected.
- `packages/symplek-mcp/src/__tests__/binary-startup.test.ts`: the binary answers `tools/list`.
- `packages/symplek-mcp/src/__tests__/mcpunit-policy.test.ts`: deny, degrade and quarantine verdicts throw.

**Known drift:** the `symplek_consensus` and `symplek_debate` tools vote with simulated agents, not real ones (DEC-016). The `MCPUnit` doc example names an `http` transport that no longer exists.

## Journey G - Scaffold a project and manage agents from the CLI

**Success criterion:** `npm create symplek` produces a project by delegating to `symplek init`, and `symplek add`, `symplek validate`, `symplek generate` and `symplek migrate` operate on agent YAML.
**Cites:** DEC-002.

| Step | Command or API | Handler | Note |
|------|----------------|---------|------|
| 1 | `npm create symplek` | `packages/create-symplek/src/index.ts` | spawns `@symplek/cli` at the same version through `npx` |
| 2 | `symplek init` | `packages/symplek-cli/src/commands/init.ts` | project templates minimal, standard, full |
| 3 | `symplek add`, `symplek validate` | `packages/symplek-cli/src/commands/add.ts`, `packages/symplek-cli/src/commands/validate.ts` | agent YAML and TypeScript |
| 4 | `symplek generate`, `symplek migrate` | `packages/symplek-cli/src/commands/generate.ts`, `packages/symplek-cli/src/commands/migrate.ts` | YAML to typed code; legacy fixes |

**Tests:**
- `packages/symplek-cli/src/commands/__tests__/init.test.ts`: names, `createProject`, package manager, templates.
- `packages/symplek-cli/src/commands/__tests__/generate.test.ts` and `packages/symplek-cli/src/commands/__tests__/generate-compile.test.ts`: generated code content and compile.
- `packages/symplek-cli/src/commands/__tests__/validate.test.ts`, `packages/symplek-cli/src/commands/__tests__/add.test.ts`, `packages/symplek-cli/src/commands/__tests__/migrate.test.ts`.

**Known drift:** `create-symplek` has no test of its own.

## Journey H - Plan, verify, then execute an agent SDK session (alpha)

**Success criterion:** a plan is produced read-only, approved by a consensus vote the caller runs, and executed under a permission bridge that blocks any tool the plan did not declare, with results honestly marked when no real SDK ran.
**Cites:** DEC-013.

| Step | Command or API | Handler | Note |
|------|----------------|---------|------|
| 1 | `createHarness` | `packages/symplek-harness/src/adapter/claude-agent-sdk.ts` | adapter `claude-agent-sdk` or `openai-agents` |
| 2 | `plan` | `packages/symplek-harness/src/operators/plan.ts` | read-only tools only; synthesised plan while no SDK loads |
| 3 | `getConsensusDefaults` | `packages/symplek-harness/src/consensus-defaults.ts` | per impact tier thresholds; the package has no verify step, the caller builds the `VerifiedPlan` |
| 4 | `buildPermissionBridge` | `packages/symplek-harness/src/permission-bridge.ts` | derived from the verified plan |
| 5 | `execute`, `session` | `packages/symplek-harness/src/operators/execute.ts`, `packages/symplek-harness/src/operators/session.ts` | stub session today |

**Tests:**
- `packages/symplek-harness/src/__tests__/honesty.test.ts`: stub results carry `synthesized`, never `verified`.
- `packages/symplek-harness/src/__tests__/provenance.test.ts`: the `requireMinChainConfidence` gate and per-tool source confidence.
- `packages/symplek-harness/src/__tests__/consensus-defaults.test.ts`: tier thresholds.
- `packages/symplek-harness/src/__tests__/replay.test.ts`: `assertDeterministic`, `ReplayAdapter`, trace parsing.

**Known drift:** `plan`, `execute` and `session` all run stubs today; no real SDK is reached (DEC-013).

## Entry points covered by no journey

| Entry point | Disposition |
|---|---|
| `@symplek/pro` (`tacoConsensus`, `ConfidentStigmergyLayer`, `AntibodyRegistry`) | own journey once the licence gate is testable (INV-012); exercised today by `packages/symplek-pro/src/__tests__/golden-path.test.ts` |
| `@symplek/devtools` extension | out of scope until a producer exists (DEC-018) |
| `@symplek/core/change-kernel`, `@symplek/core/interview`, `@symplek/core/solo`, `Team` | covered by their own module suites, not yet a journey |
