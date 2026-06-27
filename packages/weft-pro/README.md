# weft-pro

**Advanced multi-agent consensus, observability, and security primitives for production AI systems.**

> **Status: Experimental** — All exports produce real, testable behavior. No production consumers yet. Treat the API surface as unstable until 1.0.0 stable.

---

## Install

```bash
npm install weft-core weft-pro
# or
pnpm add weft-core weft-pro
```

`weft-core` is a required peer dependency.

---

## What weft-pro adds

| Feature | Description | weft-core | weft-pro |
|---|---|:---:|:---:|
| Lazy agent monad (`AgentUnit`) | Compose agents without executing until `.run()` | ✓ | ✓ |
| Resilience operators | `.retry()`, `.timeout()`, `.fallback()` | ✓ | ✓ |
| Single-round consensus | Vote once, tally, return `approved` | ✓ | ✓ |
| **Multi-round TaCo consensus** | Agents share rationale and revote until convergence | — | ✓ |
| **Stigmergic confidence** | Pheromone-based coordination with evaporation/decay | — | ✓ |
| **Agent antibodies** | Runtime output pattern scanning — reject, warn, quarantine | — | ✓ |
| **Basic observability** | Span tracing, cost tracking, collector hooks (in-memory) | ✓ | ✓ |
| **Advanced observability** | Multi-agent trace aggregation, cost dashboards, distributed tracing | — | ✓ |
| **Trust registry** | Trusted-traveler lanes, configurable scan depth per agent | — | ✓ |
| **Teams** | Named reusable agent teams with shared configuration | — | ✓ |
| **Change-kernel** | Approval workflows, escalation, merge, classification | — | ✓ |
| **Coherence/Confidence modules** | Standalone calculation libraries (variance, entropy, composite) | — | ✓ |

---

## When you need pro

**Your agents need to reach agreement over multiple rounds.**
Single-round consensus (free) votes once. TaCo iterates — agents see each other's rationale, revise their votes, and converge. Use when a single-pass vote produces low-confidence or unstable outcomes.

**You need to catch bad outputs before they propagate.**
Agent antibodies scan every result against a registry of regex, substring, and structural matchers. Block XSS patterns, hallucinated field names, schema violations, or any custom pattern before it reaches downstream consumers.

**You need span-level tracing across a workflow.**
Basic observability (span recording, cost/error tracking, in-memory trace store, collector hook) is included in `weft-core` at no cost. `weft-pro` adds advanced observability: multi-agent trace aggregation, cost dashboards, and distributed tracing for organisational-scale deployments.

**You need trust-based routing.**
Tag agents or callers with trust levels and expiration. Route deeper, more expensive analysis only when trust score warrants it.

**You're building reusable agent teams.**
Define a `Team` once with its agents, mode (converge/dialectic), and options. Reuse it across multiple workflows without repeating configuration.

---

## TaCo consensus example

```typescript
import { AgentUnit, createContext } from "weft-core";
import { tacoConsensus } from "weft-pro";

const ctx = createContext();

// tacoConsensus returns a transform: (unit) => AgentUnit<TaCoResult>
const proposal = AgentUnit.from(async () => "Adopt async job queue for all background tasks");

const result = await tacoConsensus(
  [
    async (_text, _rationaleCtx) => ({
      agentId: "architect",
      decision: "approve" as const,
      rationale: "Matches our scalability requirements",
      confidence: 0.9,
    }),
    async (_text, rationaleCtx) => ({
      agentId: "ops",
      decision: rationaleCtx ? ("approve" as const) : ("reject" as const),
      rationale: rationaleCtx
        ? "Reconsidering after seeing architect rationale"
        : "Adds operational overhead",
      confidence: 0.75,
    }),
  ],
  { maxRounds: 3, showRationales: true },
)(proposal).run(ctx);

console.log(result.value.approved);            // true
console.log(result.value.rounds.length);       // 2
console.log(result.value.converged);           // true
console.log(result.value.finalAgreementLevel); // e.g. 0.83
```

---

## Antibody example

```typescript
import { AntibodyRegistry } from "weft-pro";

const registry = new AntibodyRegistry();

registry.registerPattern({
  id: "xss-1",
  matcher: { type: "regex", pattern: /<script[^>]*>/i },
  description: "Script injection in agent output",
  severity: "critical",
  learnedAt: Date.now(),
});

const scan = registry.scan(agentOutputString);
if (scan.recommendation === "reject") {
  throw new Error(`Agent output blocked: ${scan.matches.map((m) => m.id).join(", ")}`);
}
```

---

## Observability example

```typescript
import { createOperatorSpan, getTraces, configureObservability } from "weft-pro";

configureObservability({ enabled: true, verbosity: "verbose" });

const span = createOperatorSpan("llm", "generate");
span.setAttribute("model", "gpt-4o");

const output = await runMyAgent();

span.end({ tokens: output.usage?.totalTokens });

const traces = getTraces();
console.log(traces[0].durationMs); // wall-clock time for the span
```

---

## Upgrade path

Already using `weft-core`? Add `weft-pro` alongside it — no breaking changes.

```bash
# Add pro without removing core
pnpm add weft-pro
```

Import pro features directly alongside your existing `weft-core` imports:

```typescript
import { AgentUnit, createContext } from "weft-core"; // unchanged
import { tacoConsensus, AntibodyRegistry } from "weft-pro"; // additive
```

---

## License

Commercial License — see [LICENSE](LICENSE) for details.
