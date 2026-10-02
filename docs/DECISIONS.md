# Decisions

Append-only log of active architectural decisions. Superseded entries move to `docs/decisions-archive.md` (never loaded).
Every INV "why" and every non-default convention in the project router (CLAUDE.md) should cite a DEC id.
Verified against weft-workspace @ a9c2894 on 2026-09-29. Dates come from git history where the decision predates this log; this repo's first commit is 2499542 (2026-05-11), so earlier history lives in the private canonical source.

## How this log works

- Append only. Never edit an accepted decision's Decision, Options rejected or Consequences. Correct a fact in place only when it was wrong (note it in the entry).
- Supersede, don't rewrite: add a new DEC-nnn, set the old entry's Status to `superseded by DEC-nnn`, then move the old entry verbatim to `docs/decisions-archive.md` and list its id under "Superseded decisions" below. The new entry's Context must name the id it supersedes.
- Next free id: DEC-019. Fields per entry: Date, Status, Context, Decision, Options rejected, Consequences, Confirmation, Anchors.
- A significant departure from the architecture is always resolved one of two ways: conform the code, or append a DEC here. Never silent.
- Entries reconstructed at baseline (decided before this log) say so in "Options rejected" ("not recorded at the time"); do not treat reconstructed options as evidence.
- Entries with Status `open` are baseline findings that need an operator decision: either conform the code or turn the entry into an accepted decision.

## Active decisions

DEC-001 · Canonical docs and the architecture drift gate
  Date: 2026-09-29
  Status: accepted
  Context: architecture intent that code cannot express (boundaries, rationale, invariants, journeys) drifts silently between changes and between agent sessions.
  Decision: six canonical docs in `docs/` (ARCHITECTURE, DECISIONS, INVARIANTS, JOURNEYS, PRODUCT, DESIGN) plus `docs/ANCHORS.json` bind them to the code. A significant departure is resolved by conforming the code or recording a DEC here, never silently. Derivable facts are generated into `docs/generated/`, never hand-written.
  Options rejected: prose docs with no anchors (they rot unnoticed); a wiki outside the repo (cannot be checked at commit time).
  Consequences: hooks inject the relevant doc section when an anchored file is edited and check anchors and generated-doc freshness at commit. Older architecture notes (`docs/ARCHITECTURE-FULL.md`, `docs/tier-boundary.md`) are reconciled into these docs and left for the operator to retire.
  Confirmation: `node .claude/scripts/docs/canonical-docs.cjs --check` passes and `node .claude/scripts/testing/drift-gate.cjs audit` reports zero Tier A.
  Anchors: docs/ANCHORS.json

DEC-002 · pnpm workspace of independently versioned packages, released with changesets
  Date: 2026-05-11 (git: 2499542)
  Status: accepted
  Context: ten packages with different audiences and licences live in one repo; nine must publish separately and `weft-devtools` is private.
  Decision: a pnpm workspace over `packages/*`, Node 20 or later, Biome for lint with the formatter off, Changesets for versions and publish, with `weft-core` and `weft-pro` linked and `create-weft` and `weft-cli` linked.
  Options rejected: not recorded at the time.
  Operator rationale (2026-10-01): Nothing else was seriously considered; the operator confirmed 2026-10-01 that no alternatives were weighed.
  Consequences: CI filters on `weft-*` and `create-weft`; a package with no `lint` or `typecheck` script silently skips that CI step (see the baseline report).
  Confirmation: `.github/workflows/ci.yml` runs lint, typecheck, build and test over the filtered packages; `.changeset/config.json` holds the linked groups.
  Anchors: pnpm-workspace.yaml, .changeset/config.json, biome.json, .github/workflows/ci.yml

DEC-003 · Open-core tier split: developer primitives free in weft-core, organisational features in weft-pro
  Date: 2026-05-11 (git: 2499542)
  Status: accepted
  Context: developer tools stay free; team coordination, governance and advanced observability are the commercial tier (`docs/tier-boundary.md`, buyer-based open core).
  Decision: `weft-core` (MIT) holds every `AgentUnit` operator, observability primitives, solo, interview, rehearsal, teams, confidence and coherence. `weft-pro` (BUSL-1.1) adds TaCo, stigmergy, antibodies and trust lanes, and re-exports core modules. `weft-core` never imports `weft-pro`.
  Options rejected: not recorded at the time.
  Operator rationale (2026-10-01): Nothing else was seriously considered; the operator confirmed 2026-10-01 that no alternatives were weighed.
  Consequences: a feature is placed by the rule "developer primitive is core, organisational or governance is pro". The import ban is checked only by a CI grep.
  Confirmation: the `tier-boundary` job in `.github/workflows/ci.yml`; `packages/weft-core/src/__tests__/tierBoundary.test.ts` proves the free operators exist without `weft-pro`.
  Anchors: docs/tier-boundary.md, packages/weft-core/src/__tests__/tierBoundary.test.ts, packages/weft-pro/src/index.ts, .github/workflows/ci.yml

DEC-004 · This repo is a distribution mirror of a private canonical source; sync is manual per release
  Date: 2026-05-11 (git: 2499542)
  Status: accepted
  Context: Weft is developed inside a private application monorepo; this repo is the public source of the published packages (`SYNC.md`).
  Decision: maintainers copy the portable subset here at release time and backport merged external PRs upstream. Some differences from the canonical source are deliberate (error codes, the builder surface, retry option names) and must not be aligned.
  Options rejected: not recorded at the time.
  Operator rationale (2026-10-01): Nothing else was seriously considered; the operator confirmed 2026-10-01 that no alternatives were weighed.
  Consequences: `packages/weft-core/src/__tests__/canonicalMirrorContract.test.ts` is meant to catch drift but skips itself here because the canonical directory is absent, so drift is only caught upstream.
  Confirmation: none in this repo (see INV-013); the contract test runs only in the upstream checkout.
  Anchors: SYNC.md, CONTRIBUTING.md, packages/weft-core/src/__tests__/canonicalMirrorContract.test.ts

DEC-005 · AgentUnit is a lazy immutable monad; operators attach by prototype augmentation
  Date: 2026-05-11 (git: 2499542)
  Status: accepted
  Context: one composable type must carry every coordination pattern with full TypeScript inference.
  Decision: `AgentUnit<T>` in `packages/weft-core/src/AgentUnit/AgentUnit.ts` holds the base methods; each operator file assigns onto the prototype and its signature is merged into one `interface AgentUnit<T>`. Consumers import via the barrel, and `run()` throws `SETUP_ERROR` if the augmentation did not load.
  Options rejected: not recorded at the time. The source notes moving all operators into the class body as deferred future work.
  Operator rationale (2026-10-01): Nothing else was seriously considered; the operator confirmed 2026-10-01 that no alternatives were weighed.
  Consequences: a new operator needs three edits (file, barrel, merged interface). Flip trigger: the class-body refactor named in the source.
  Confirmation: none that can fail: the `SETUP_ERROR` case in `packages/weft-core/src/__tests__/golden-path.test.ts` builds its own `WeftError` and never triggers the guard (INV-006). The barrel and operator presence is held by `packages/weft-core/src/__tests__/tierBoundary.test.ts`.
  Anchors: packages/weft-core/src/AgentUnit/AgentUnit.ts, packages/weft-core/src/AgentUnit/operators/index.ts

DEC-006 · Zero-trust results by default: run returns a TrackedResult with unforgeable provenance
  Date: 2026-07-07 (git: 4da19c2)
  Status: accepted
  Context: agent output and cached results must not be spoofable; a forged result must be rejected by the type guard.
  Decision: `run()` wraps values in a `TrackedResult` created only by `createTrackedResult`; authenticity is a module-private WeakSet plus a private Symbol. `trustMode: "legacy"` returns the raw value, is deprecated and is scheduled for removal in v3.0.
  Options rejected: not recorded at the time (the hardening commit cites a Codex finding, not alternatives).
  Operator rationale (2026-10-01): Nothing else was seriously considered; a Codex finding drove it. The operator confirmed 2026-10-01 that no alternatives were weighed.
  Consequences: every store and cache must validate with `isTrackedResult` before returning a cached value.
  Confirmation: `packages/weft-core/src/__tests__/trust-hardening.test.ts` and `packages/weft-core/src/__tests__/zero-trust.test.ts`.
  Anchors: packages/weft-core/src/trust.ts, packages/weft-core/src/AgentUnit/zeroTrust.ts

DEC-007 · Browser-safe root barrel; provider-bound code lives at weft-core/server
  Date: 2026-05-11 (git: 2499542)
  Status: accepted
  Context: the root package must import in browsers and bundlers without pulling provider SDKs.
  Decision: `packages/weft-core/src/index.ts` exports the client-safe surface; `Weft`, `WeftBuilder`, `ai`, `stream` and the provider registry are exported only from `packages/weft-core/src/server.ts`. Heavier optional modules get their own subpath in `packages/weft-core/package.json`.
  Options rejected: not recorded at the time.
  Operator rationale (2026-10-01): Nothing else was seriously considered; the operator confirmed 2026-10-01 that no alternatives were weighed.
  Consequences: browser code must not import from `weft-core/server`; `weft-react` excludes its server-bound hooks for this reason (DEC-011).
  Confirmation: `packages/weft-core/src/__tests__/boundaryTest.test.ts` fails if a server-only symbol reaches the root barrel.
  Anchors: packages/weft-core/src/index.ts, packages/weft-core/src/server.ts, packages/weft-core/src/__tests__/boundaryTest.test.ts

DEC-008 · Providers sit behind one interface and a process-wide registry
  Date: 2026-05-11 (git: 2499542)
  Status: accepted
  Context: operators and the tool loop must not know which vendor answers.
  Decision: adapters implement `Provider` (`packages/weft-core/src/providers/interface.ts`), register in `providerRegistry`, and are selected by `detectProvider`: registry default first, then OpenAI, Anthropic, Google by environment key. OpenRouter is deliberately not detected until a base-URL-aware adapter exists.
  Options rejected: not recorded at the time.
  Operator rationale (2026-10-01): Nothing else was seriously considered; the operator confirmed 2026-10-01 that no alternatives were weighed.
  Consequences: provider state is a module singleton; tests reset it. An unwired `CircuitBreaker` sits in `packages/weft-core/src/providers/circuit.ts` and is not part of the path.
  Confirmation: `packages/weft-core/src/__tests__/facade.test.ts` covers `configure`, provider detection and the OpenRouter regression.
  Anchors: packages/weft-core/src/providers/interface.ts, packages/weft-core/src/providers/registry.ts, packages/weft-core/src/providers/auto.ts

DEC-009 · Deterministic record and replay with vector-clocked traces
  Date: 2026-05-11 (git: 2499542)
  Status: accepted
  Context: agent tests need repeatable runs without paying for model calls.
  Decision: `.rehearse()` records events with vector clocks and DJB2 hashes; `.replay()` verifies hashes and reports divergences without running the body; golden traces add SHA-256 output hashes, default redaction and `replayAgentWithTrace`. Provider-level interception is not implemented, so a zero-token replay holds only for agents that call the injected interceptor.
  Options rejected: not recorded at the time.
  Operator rationale (2026-10-01): Nothing else was seriously considered; the operator confirmed 2026-10-01 that no alternatives were weighed.
  Consequences: DJB2 detects corruption, not tampering; the conditional zero-cost guarantee must be stated wherever replay is described.
  Confirmation: `packages/weft-core/src/rehearsal/__tests__/golden.test.ts` ("zero-token guarantee is conditional") and `packages/weft-core/src/rehearsal/__tests__/integration.test.ts`.
  Anchors: packages/weft-core/src/rehearsal/, packages/weft-core/src/AgentUnit/operators/rehearsal.ts

DEC-010 · Durable execution through one KV seam; at-most-once is narrowed, not closed
  Date: 2026-07-26 (git: 696f2d0)
  Status: accepted
  Context: idempotency and a transaction log must survive restarts without a store per feature.
  Decision: implement the four-method `DurableStoreBackend` and get durable idempotency and a session-local transaction log from `createDurableStore`. Only a file backend ships in core; other backends live downstream. A failed write after a side effect leaves the key unwritten and the step re-executes.
  Options rejected: not recorded at the time.
  Operator rationale (2026-10-01): Nothing else was seriously considered; the operator confirmed 2026-10-01 that no alternatives were weighed.
  Consequences: the guarantee boundary is stated in the source and must be repeated in any doc that mentions durability; sub-step skipping needs explicit per-step keys.
  Confirmation: `packages/weft-core/src/__tests__/store.test.ts` (including case-aliasing and write-ordering suites).
  Anchors: packages/weft-core/src/store/, packages/weft-core/src/idempotency.ts

DEC-011 · weft-react exports only browser-safe hooks
  Date: 2026-05-11 (git: 2499542)
  Status: accepted
  Context: `useAI`, `useAIQuery` and `useAIStream` import `weft-core/server`, which pulls provider SDKs.
  Decision: `packages/weft-react/src/index.ts` exports the error boundary, the provider and `useAgent`, `useConsensus`, `useSwarm`; the three server-bound hook files stay in the package tree, unexported.
  Options rejected: not recorded at the time.
  Operator rationale (2026-10-01): Nothing else was seriously considered; the operator confirmed 2026-10-01 that no alternatives were weighed.
  Consequences: the unexported hook files are dead weight until they are moved or removed.
  Confirmation: `packages/weft-react/src/__tests__/integration.test.tsx` runs the hooks from the root export.
  Anchors: packages/weft-react/src/index.ts, packages/weft-react/src/hooks/useAI.ts

DEC-012 · Two agent constructors exist; neither runs tools
  Date: 2026-10-01 (opened 2026-09-29 (baseline finding))
  Status: accepted
  Context: `ai.agent` and `Weft.agent` are different implementations. The first (`createAgent` in `packages/weft-core/src/agent/agent.ts`, via `executeAgent`) never executes tools; the second (`AgentBuilder`) has no tool support. Real tool execution is `AgentUnit.loop` via `executeLoop`.
  Decision: Retire ai.agent (createAgent and executeAgent in packages/weft-core/src/agent/). There are no users yet, so the breaking change costs nothing. AgentUnit.loop via executeLoop is the single tool-running path; Weft.agent stays as the builder facade. Close with a test that ai.agent is gone from the public surface and that tools passed to the builder or loop are executed or rejected. (operator, 2026-10-01)
  Options rejected: none recorded.
  Consequences: until the retirement lands, a caller who passes `tools` to `ai.agent` gets a plain generation with no error.
  Confirmation: none yet; a test that `ai.agent` is gone from the public surface, and that tools passed to the builder or loop are executed or rejected, would close it.
  Anchors: packages/weft-core/src/agent/agent.ts, packages/weft-core/src/agent.ts, packages/weft-core/src/agent/executor.ts

DEC-013 · weft-harness runs stub sessions until SDK wiring lands
  Date: 2026-10-01 (opened 2026-09-29 (baseline finding))
  Status: accepted
  Context: in `packages/weft-harness/src/adapter/claude-agent-sdk.ts` the session loader always returns null with a TODO, so `execute` returns no-op stub output marked synthesized, while `session` returns stub output stamped `source: "agent"` at confidence 0.5 with no stub marker (`packages/weft-harness/src/operators/session.ts`); `packages/weft-harness/src/operators/plan.ts` has a second loader that also returns null, so `plan` synthesises its plan from the declared tools.
  Decision: Wire the Claude Agent SDK first. The package does not ship its current stub-session behaviour as the intended end state; the README claim is not narrowed, the wiring is the work. Until it lands the package stays alpha and stub results must carry provenance synthesized. (operator, 2026-10-01)
  Options rejected: none recorded.
  Consequences: `execute` and `plan` results carry provenance `synthesized`, so those stubs cannot pass as verified. `session` results are stamped `agent`, so a session stub can pass as agent output until that is fixed.
  Confirmation: `packages/weft-harness/src/__tests__/honesty.test.ts` covers `execute` and `plan`; nothing covers `session`.
  Anchors: packages/weft-harness/src/adapter/claude-agent-sdk.ts, packages/weft-harness/src/adapter/openai-agents.ts

DEC-014 · weft-testing is a re-export shell over weft-core/rehearsal
  Date: 2026-05-11 (git: 2499542)
  Status: accepted
  Context: a separate copy of the replayer had drifted and lacked integrity checks; the engine must exist once.
  Decision: `packages/weft-testing/src/index.ts` re-exports `weft-core/rehearsal`; the per-file shells under `packages/weft-testing/src/rehearsal/` keep old import paths working.
  Options rejected: not recorded at the time.
  Operator rationale (2026-10-01): Nothing else was seriously considered; the operator confirmed 2026-10-01 that no alternatives were weighed.
  Consequences: the package's own test suite duplicates the core rehearsal tests by name and is the only place the shells are exercised.
  Confirmation: `packages/weft-testing/src/rehearsal/__tests__/replayer.test.ts` imports through the shell.
  Anchors: packages/weft-testing/src/index.ts, packages/weft-testing/src/rehearsal/replayer.ts

DEC-015 · weft-pro is gated by an import-time licence key format check
  Date: 2026-07-07 (git: 4da19c2)
  Status: accepted
  Context: Pro features must not load without a licence key.
  Decision: every pro module imports `packages/weft-pro/src/license-gate.ts`, which throws at load unless the licence-key environment variable matches a fixed format. Validation is local and format-only; server-side validation is planned. The legal control is the BUSL-1.1 licence.
  Options rejected: not recorded at the time.
  Operator rationale (2026-10-01): Nothing else was seriously considered; the operator confirmed 2026-10-01 that no alternatives were weighed.
  Consequences: any well-formed key opens the gate, and because the gate throws at import, `validateLicense(key)` cannot be called first when the env var is unset.
  Confirmation: none that can fail (see INV-012); `packages/weft-pro/src/__tests__/license.test.ts` re-tests a regex, not the gate.
  Anchors: packages/weft-pro/src/license-gate.ts, packages/weft-pro/LICENSE

DEC-016 · weft-mcp speaks stdio JSON-RPC by hand and validates inputs at the boundary
  Date: 2026-05-11 (git: 2499542)
  Status: accepted
  Context: MCP clients call Weft operators as tools; the server must not trust `tools/call` arguments.
  Decision: `packages/weft-mcp/src/server/index.ts` implements the stdio transport without the MCP SDK and validates arguments with the JSON-Schema-subset checker in `packages/weft-mcp/src/server/validateInput.ts`. The client side supports stdio only; an HTTP transport was removed because it spoke private REST routes.
  Options rejected: not recorded at the time. The source notes the MCP SDK is only a devDependency and the transport is self-contained; an HTTP client transport was removed as spec-incompatible.
  Operator rationale (2026-10-01): Nothing else was seriously considered; the operator confirmed 2026-10-01 that no alternatives were weighed.
  Consequences: only the listed schema subset is checked. The `weft_consensus` and `weft_debate` tools use simulated voters (see the baseline report).
  Confirmation: `packages/weft-mcp/src/server/__tests__/validateInput.adversarial.test.ts`, `packages/weft-mcp/src/__tests__/binary-startup.test.ts`.
  Anchors: packages/weft-mcp/src/server/index.ts, packages/weft-mcp/src/server/validateInput.ts, packages/weft-mcp/src/client/MCPTransportClient.ts

DEC-017 · weft-pro carries its own copy of the contract module
  Date: 2026-10-01 (opened 2026-09-29 (baseline finding))
  Status: accepted
  Context: `packages/weft-pro/src/contract.ts` is a line-for-line copy of `packages/weft-core/src/contract.ts` plus the licence-gate import, and the pro barrel exports its own `ContractError` and `defineContract`.
  Decision: Re-export from weft-core like the other pro shells. The pro contract module keeps only the licence-gate import and re-exports ContractError and defineContract from weft-core, so there is one class and instanceof works across packages. Close with an identity test (weft-pro ContractError equals weft-core ContractError). (operator, 2026-10-01)
  Options rejected: none recorded.
  Consequences: a `ContractError` thrown by core fails an `instanceof` check against the pro class, and fixes must land twice.
  Confirmation: none yet; an identity test (`weft-pro` `ContractError` equals `weft-core` `ContractError`) would close it.
  Anchors: packages/weft-pro/src/contract.ts, packages/weft-core/src/contract.ts

DEC-018 · The DevTools bridge has a listener but no producer
  Date: 2026-10-01 (opened 2026-09-29 (baseline finding))
  Status: accepted
  Context: `weft-devtools` (private, unpublished) accepts window messages tagged `Weft-page`, but no package in the repo posts them: the emitter functions are defined inside the extension and `weft-core` never calls them, while the README says observability output appears in the panel.
  Decision: Wire weft-core observability to the DevTools emitter so the README claim becomes true and the listener's origin, shape and size gates are exercised end to end. Close with an end-to-end test from a weft-core observability event to the panel listener. (operator, 2026-10-01)
  Options rejected: none recorded.
  Consequences: the origin, shape and size gates in the listener cannot be exercised end to end.
  Confirmation: none yet; only a type-shape smoke test exists.
  Anchors: packages/weft-devtools/src/bridge/page-emitter.ts, packages/weft-devtools/src/content/bridge-listener.ts, packages/weft-core/src/observability.ts

## Superseded decisions
(none yet)
