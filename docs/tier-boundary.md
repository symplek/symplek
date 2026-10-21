# Symplek Open Core — Tier Boundary

Symplek follows the **Buyer-Based Open Core** model: developer tools are free; organisational
and governance features require a commercial license.

---

## Free tier — `@symplek/core` (MIT)

`AgentUnit<T>` is the core primitive. All developer composition operators are available
without any commercial license.

### AgentUnit operators (all free)

| Operator | Method | Purpose |
|---|---|---|
| Solo | `.solo(config?)` | Autonomous execution when confidence + coherence are high |
| Consensus | `.consensus(voters, options?)` | Single-round multi-voter decision |
| Converge | `.converge(agents, options?)` | Iterative multi-agent refinement loop |
| Debate | `.debate(agents, options?)` | Converge + unanimous consensus sign-off |
| Dialectic | `.dialectic(leader, advisors, options?)` | Leader-driven thesis/antithesis/synthesis |
| Coherence | `.coherence(options?)` | Post-consensus coherence check + threshold gate |
| Interview | `.interview(config)` | Lazy human-in-the-loop Q&A configuration |
| Conduct | `.conduct(handlers)` | Execute a pending interview |
| Rehearse | `.rehearse(options?)` | Record execution trace for deterministic replay |
| Replay | `.replay(trace, options?)` | Replay a recorded trace deterministically |
| Retry | `.retry(maxAttempts?, options?)` | Resilience: exponential backoff retry |
| Timeout | `.timeout(ms)` | Resilience: fail if not finished in time (the work underneath is not cancelled) |
| Fallback | `.fallback(unit)`, `.orElse(value)` | Resilience: backup unit or static value on failure |
| Track | `.tracked(options)` | Label a result with a source and confidence you supply |
| Transform | `.map(fn)`, `.flatMap(fn)`, `.branch(...)`, `.tap(fn)` | Functional transformations |
| Parallel | `AgentUnit.race(units)`, `AgentUnit.zipAll(units)`, `.zip(other)` | Parallel execution primitives |

### Observability primitives (free)

| Function | Purpose |
|---|---|
| `observable(unit, options?)` | Wrap an `AgentUnit` so a successful run records one trace entry (no timing; failures are not recorded) |
| `createOperatorSpan(type, name, parentSpanId?)` | Create a manually-timed span with `.end()` |
| `getTraces()` | Read the in-memory trace store |
| `clearTraces()` | Clear the in-memory trace store |
| `configureObservability(options)` | Set verbosity and an optional collector. The `trackCosts` and `trackErrors` flags are stored but nothing reads them yet |
| `getObservabilityConfig()` | Read the current observability configuration |
| `trackCost(span, tokens, model?)` | Record token cost on a span |
| `trackError(span, error)` | Record error metadata on a span |

Moved from `@symplek/pro` to `@symplek/core` in the opencore release so developers can
debug their agent compositions without a commercial license. Advanced observability
(multi-agent trace aggregation, cost dashboards, distributed tracing) will live
in `@symplek/pro` when added.

### What's in `@symplek/core`

- `AgentUnit` class with all operators above
- `SymplekError` + error codes
- `createContext` + `AgentContext`
- Provider resolution (`resolveModelFromContext`)
- Interview module (`interview/`) — full Q&A engine
- Solo module (`solo/`) — decision, lock, transaction log
- Rehearsal module (`rehearsal/`) — recorder, replayer, trace storage
- Observability module (`observability.ts`): in-memory trace store, span instrumentation, collector hook
- Teams (`Team`, `TeamRegistry`), the change-kernel (`@symplek/core/change-kernel`), and the coherence and confidence libraries (`@symplek/core/coherence`, `@symplek/core/confidence`)

---

## Pro tier — `@symplek/pro` (Commercial license)

Features that serve **team coordination, governance, and observability at organisational scale**.

| Feature | Description |
|---|---|
| **TaCo consensus** (`tacoConsensus`) | Multi-round iterative voting with convergence control |
| **Stigmergy** (`ConfidentStigmergyLayer`) | Pheromone-based confidence with evaporation/decay |
| **Antibodies** (`AntibodyRegistry`) | Pattern detection, quarantine, and learning for bad outputs |
| **Trust registry** (`TrustRegistry`) | Trusted-traveler lanes, scan-depth control per agent |
| **Teams** (`Team`, `TeamRegistry`) | Named reusable agent teams with shared configuration |
| **Change-kernel** | Approval workflows, escalation, merge, classification |
| **Coherence/Confidence modules** | Standalone calculation libraries (variance, entropy, composite) |

> **Where the code stands today**: the table above is the intended tier line, and the code has not caught up with it.
> `@symplek/core` (MIT) exports `Team` and `TeamRegistry`, the change-kernel (`@symplek/core/change-kernel`) and the coherence and
> confidence libraries (`@symplek/core/coherence`, `@symplek/core/confidence`). `@symplek/pro` re-exports those same modules from
> `@symplek/core` behind its licence gate. The code that exists only in `@symplek/pro` is TaCo consensus, stigmergy, antibodies
> and the trust registry. Importing `@symplek/pro` throws unless the `SYMPLEK_PRO_LICENSE_KEY` environment variable holds a key.

> **Note on observability**: Basic observability (span recording, trace store, cost/error
> tracking, manual span instrumentation, collector hook) moved to `@symplek/core` in the opencore
> release. `@symplek/pro` will add advanced observability features (multi-agent trace aggregation,
> cost dashboards, distributed tracing) when those are built.

> **Note on operator vs. factory distinction**:
>
> `dialectic`, `debate`, `solo`, and `coherence` are **free-tier `AgentUnit` instance methods**
> (e.g. `agent.dialectic(leader, advisors, options?)`). They are available on every `AgentUnit`
> via prototype augmentation and require no commercial license. `@symplek/pro` adds no operator of its
> own to `AgentUnit`. It does re-export the computation factories behind these operators
> (`createDebateComputation`, `createDialecticComputation`, `createSoloComputation`,
> `createCoherenceComputation`) from `@symplek/core`.
>
> What `@symplek/pro` adds are **standalone computation factory functions** (e.g. `tacoConsensus`)
> that wrap multi-round coordination patterns targeting team workflows. `tacoConsensus` is not
> the same as `.consensus()` — it adds iterative round management and convergence control on
> top of the free-tier primitive. Other pro factories (stigmergy, antibodies, trust) have no
> free-tier equivalent at all.
>
> Rule of thumb: if you call it as `agent.someMethod()`, it is free-tier. If you import it
> as a named function from `@symplek/pro`, it is pro-tier.

---

## Decision rule

> **Is the feature a developer primitive?** → `@symplek/core` (free)
>
> **Is it organisational / governance / operational observability?** → `@symplek/pro` (commercial)

Multi-round TaCo is in pro because it requires iterative round management and convergence
configuration that targets team workflows, not individual agent composition.

---

## Verification

```bash
# Confirm no @symplek/pro imports in @symplek/core source (prints nothing when the boundary holds).
# Searching for the bare string "@symplek/pro" also matches comments, so match import forms only.
grep -rEl "(from|import\(|require\()\s*['\"]@symplek/pro" packages/symplek-core/src --include='*.ts'

# Run tier boundary tests
cd packages/symplek-core && pnpm vitest run src/__tests__/tierBoundary.test.ts
```
