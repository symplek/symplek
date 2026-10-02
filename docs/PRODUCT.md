# Product

> Owner: operator. Seeded 2026-09-29 from the live code and existing project docs. Journeys live in `docs/JOURNEYS.md`; decisions in `docs/DECISIONS.md` (DEC-nnn); invariants in `docs/INVARIANTS.md` (INV-nnn).
> Items marked "operator to confirm" are product intent the code cannot prove.

## Thesis
<!-- CONFIRMED(thesis): operator 2026-10-01 -->

Weft is a set of TypeScript libraries for composing LLM agents as one small algebra: `AgentUnit<T>` chains retry, timeout, fallback, consensus, debate and tool loops as method calls, returns results that carry their own provenance, and records runs so tests replay them without paying for the model. It is for application developers who would otherwise hand-write that coordination scaffolding. It is open core: developer primitives are free (`weft-core`, MIT) and organisational features are commercial (`weft-pro`, BUSL-1.1) (DEC-003). Operator to confirm: the target buyer for the paid tier and the commercial model beyond the licence text.

## Users and jobs
<!-- CONFIRMED(users): operator 2026-10-01 -->

| Role | Job they want done |
|------|-------------------|
| Application developer (calls `weft-core`) | Coordinate several model calls with retries, voting and typed results without writing the plumbing |
| Frontend developer (calls `weft-react`) | Run an agent from a component and survive its failures |
| Convex developer (calls `weft-convex`) | Call a model from a Convex action with scoped activity and cost logging |
| Test author (calls `weft-testing`, `weft-harness`) | Record an agent run once and replay it in CI at no token cost |
| Editor or agent-client user (Claude Code, Cursor) | Call Weft operators as MCP tools |
| Project starter (runs `create-weft`, `weft-cli`) | Scaffold and validate an agent project from YAML |
| Team or organisation (adopts `weft-pro`) | Coordinate agents with iterative consensus, trust lanes and antibodies |
| Maintainer | Sync this mirror with the private source and publish releases (DEC-004) |
| External contributor | Land a change here that maintainers backport upstream |

## Core journeys

| Journey | One-line success | Proof today |
|---------|------------------|-------------|
| A - Compose and run an agent | Chain operators, run, read a `TrackedResult` | `golden-path.test.ts`, `facade.test.ts` |
| B - Tool loop with a human gate | Approval-gated tools run only when approved | `tool-loop.test.ts` |
| C - Record and replay | A golden trace replays in CI with a stated cost guarantee | `golden.test.ts`, `integrity-defects.test.ts` |
| D - Durable and resumable runs | One execution per key, cached result on resume | `store.test.ts`, `idempotency.test.ts` |
| E - React and Convex apps | Hooks and `withAI` work inside an app | `integration.test.tsx`, `withAI-scoping.test.ts` |
| F - MCP tools | Validated stdio tools and trust-policy-gated consumption | `server.test.ts`, `mcpunit-policy.test.ts` |
| G - CLI scaffolding | `npm create weft` and `weft` subcommands | `init.test.ts`, `generate.test.ts` |
| H - Harness (alpha) | Plan, approve, execute under a permission bridge | `honesty.test.ts`; runs stubs only |

Roles with no journey: team or organisation (`weft-pro`), external contributor, maintainer.

## Non-goals / no-gos
<!-- CONFIRMED(non-goals): operator 2026-10-01 -->

- Not a hosted service or an agent runtime you deploy; consumers embed the libraries.
- Does not accept contributions that depend on the private application's Convex runtime, scheduler or database bindings (`CONTRIBUTING.md`). Alternative: contribute in `packages/` and maintainers backport.
- Does not auto-sync with the private source; sync is manual per release (`SYNC.md`).
- Does not support OpenRouter yet; it needs a base-URL-aware adapter (DEC-008).
- Does not ship database adapters for durable execution; only the file backend is in core (DEC-010).
- Does not publish the DevTools panel yet; `weft-core` observability is being wired to its emitter, and it stays private until the end-to-end test passes (DEC-018).

## Principles and trade-off rules
<!-- CONFIRMED(principles): operator 2026-10-01 -->

1. A developer primitive is free and lives in `weft-core`; an organisational or governance feature is pro (DEC-003).
2. A result is untrusted until it carries provenance; the safe mode is the default and legacy raw returns are deprecated (DEC-006).
3. State a guarantee only as far as the code proves it: durable execution narrows but does not close the at-most-once window, and replay is zero-cost only for agents that use the interceptor (DEC-009, DEC-010).
4. Anything that can act in the world needs a gate a human or a policy can refuse (INV-009, DEC-016).
5. The root package stays browser-safe; provider code lives at `weft-core/server` (DEC-007, INV-002).
6. Deliberate divergence from the private source is documented, not aligned (DEC-004).
7. Simplicity over features: one way to do each thing; overlapping paths are retired, not kept side by side (DEC-012).

## Phase

Pre-1.0. `weft-core` and `weft-pro` are at 1.0.0-beta.1, the other packages at 0.1.x, `weft-harness` at 0.1.0-alpha.1 and `weft-devtools` unpublished. `SYNC.md` holds the 1.0 release until the operator API has three to six months of external use without breaking-change pressure. Release order, decided 2026-10-01: first the now-decided changes DEC-012 (retire `ai.agent`), DEC-017 (re-export the contract module) and DEC-018 (wire DevTools); then DEC-013 (wire the Claude Agent SDK into `weft-harness`); then the enforcement debt in `docs/INVARIANTS.md`; then 1.0 after the `SYNC.md` soak.

## Domain language

| Term | Definition | Code identifiers | Not to be confused with |
|------|------------|-----------------|------------------------|
| AgentUnit | A lazy, immutable computation producing a value; nothing runs until `.run` | `packages/weft-core/src/AgentUnit/AgentUnit.ts` | a running agent process |
| Operator | A method on `AgentUnit` that returns a new unit (`retry`, `consensus`, `loop`) | `packages/weft-core/src/AgentUnit/operators/index.ts` | an MCP operator tool |
| TrackedResult | A run result with source, confidence and provenance chain | `packages/weft-core/src/trust.ts` | a raw value from `trustMode: "legacy"` |
| Zero-trust mode | The default `run` mode returning `TrackedResult` | `packages/weft-core/src/AgentUnit/zeroTrust.ts` | sandboxing |
| Rehearse and replay | Record a run to an `ExecutionTrace`, then replay it deterministically | `packages/weft-core/src/rehearsal/index.ts` | a rehearsal of a human process |
| Golden trace | A committed trace used as a test oracle | `packages/weft-core/src/rehearsal/golden.ts` | any saved trace |
| Solo | Autonomous action when confidence, coherence and risk clear thresholds, under a lock | `packages/weft-core/src/solo/decision.ts` | single-agent execution |
| Change-kernel | Severity classification, approval and escalation for changes | `packages/weft-core/src/change-kernel/index.ts` | a git or OS kernel |
| TaCo | Multi-round iterative consensus (pro) | `packages/weft-pro/src/taco.ts` | `.consensus`, the single-round free operator |
| Tier | The free or pro side of the open-core split | `docs/tier-boundary.md` | a pricing plan name |
| Canonical source, mirror | The private source and this repo | `SYNC.md` | a git mirror |
