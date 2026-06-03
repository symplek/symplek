# Weft Open Core — Tier Boundary

Weft follows the **Buyer-Based Open Core** model: developer tools are free; organisational
and governance features require a commercial license.

---

## Free tier — `weft-core` (MIT)

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
| Retry | `.retry(options)` | Resilience: exponential backoff retry |
| Timeout | `.timeout(ms)` | Resilience: hard deadline |
| Fallback | `.fallback(fn)` | Resilience: value on failure |
| Track | `.track(options?)` | Source-tracking wrapper |
| Transform | `.map(fn)`, `.pipe(fn)` | Pure functional transformations |
| Parallel | `.race()`, `.all()`, etc. | Parallel execution primitives |

### Observability primitives (free)

| Function | Purpose |
|---|---|
| `observable(unit, options?)` | Wrap an `AgentUnit` so its results emit trace entries |
| `createOperatorSpan(type, name, parentSpanId?)` | Create a manually-timed span with `.end()` |
| `getTraces()` | Read the in-memory trace store |
| `clearTraces()` | Clear the in-memory trace store |
| `configureObservability(options)` | Set verbosity, cost/error tracking, and optional collector |
| `getObservabilityConfig()` | Read the current observability configuration |
| `trackCost(span, tokens, model?)` | Record token cost on a span |
| `trackError(span, error)` | Record error metadata on a span |

Moved from `weft-pro` to `weft-core` in the opencore release so developers can
debug their agent compositions without a commercial license. Advanced observability
(multi-agent trace aggregation, cost dashboards, distributed tracing) will live
in `weft-pro` when added.

### What's in `weft-core`

- `AgentUnit` class with all operators above
- `WeftError` + error codes
- `createContext` + `AgentContext`
- Provider resolution (`resolveModelFromContext`)
- Interview module (`interview/`) — full Q&A engine
- Solo module (`solo/`) — decision, lock, transaction log
- Rehearsal module (`rehearsal/`) — recorder, replayer, trace storage
- Observability module (`observability/`) — in-memory trace store, span instrumentation, collector hook

---

## Pro tier — `weft-pro` (Commercial license)

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

> **Note on observability**: Basic observability (span recording, trace store, cost/error
> tracking, manual span instrumentation, collector hook) moved to `weft-core` in the opencore
> release. `weft-pro` will add advanced observability features (multi-agent trace aggregation,
> cost dashboards, distributed tracing) when those are built.

> **Note on operator vs. factory distinction**:
>
> `dialectic`, `debate`, `solo`, and `coherence` are **free-tier `AgentUnit` instance methods**
> (e.g. `agent.dialectic(leader, advisors, options?)`). They are available on every `AgentUnit`
> via prototype augmentation and require no commercial license. `weft-pro` does **not** shadow
> or re-export these operators.
>
> What `weft-pro` adds are **standalone computation factory functions** (e.g. `tacoConsensus`)
> that wrap multi-round coordination patterns targeting team workflows. `tacoConsensus` is not
> the same as `.consensus()` — it adds iterative round management and convergence control on
> top of the free-tier primitive. Other pro factories (stigmergy, antibodies, trust) have no
> free-tier equivalent at all.
>
> Rule of thumb: if you call it as `agent.someMethod()`, it is free-tier. If you import it
> as a named function from `weft-pro`, it is pro-tier.

---

## Decision rule

> **Is the feature a developer primitive?** → `weft-core` (free)
>
> **Is it organisational / governance / operational observability?** → `weft-pro` (commercial)

Multi-round TaCo is in pro because it requires iterative round management and convergence
configuration that targets team workflows, not individual agent composition.

---

## Verification

```bash
# Confirm no @weft/pro imports in weft-core source
rg "@weft/pro" packages/weft-core/src --glob "*.ts" -l

# Run tier boundary tests
cd packages/weft-core && pnpm vitest run src/__tests__/tierBoundary.test.ts
```
