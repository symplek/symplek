# @symplek/pro

**Advanced multi-agent consensus, observability, and security primitives for production AI systems.**

> **Status: Experimental** — All exports produce real, testable behavior. No production consumers yet. Treat the API surface as unstable until 1.0.0 stable.

---

## License key required before import

`@symplek/pro` enforces a format-validated license key at module load time. **You must set the key before importing the package**, or the import throws.

```bash
# Set before running your application
export SYMPLEK_PRO_LICENSE_KEY="symplek_pro_<40 lowercase hex chars>"
```

The key is checked against the pattern `symplek_pro_[a-f0-9]{40}` on load (format validation only; no network round-trip). Keys are available at https://symplek.com/pro.

If you need to set the key programmatically — for example in a test harness — call `validateLicense(key)` **before any `import` or `require` of `@symplek/pro`**:

```typescript
import { validateLicense } from "@symplek/pro/license"; // loads the gate only, not all exports
validateLicense("symplek_pro_" + "a".repeat(40)); // replace with your real key
import { tacoConsensus } from "@symplek/pro";
```

> Because the gate fires at module-load time, the error message "Call validateLicense(key)" means you must call it *before* the import — not after catching a thrown error.

---

## Install

```bash
npm install @symplek/core @symplek/pro
# or
pnpm add @symplek/core @symplek/pro
```

`@symplek/core` is a required peer dependency.

---

## What @symplek/pro adds

| Feature | Description | @symplek/core | @symplek/pro |
|---|---|:---:|:---:|
| Lazy agent monad (`AgentUnit`) | Compose agents without executing until `.run()` | ✓ | ✓ |
| Resilience operators | `.retry()`, `.timeout()`, `.fallback()` | ✓ | ✓ |
| Single-round consensus | Vote once, tally, return `approved` | ✓ | ✓ |
| Teams | Named reusable agent teams with shared configuration | ✓ | ✓ |
| Coherence/Confidence modules | Standalone calculation libraries (variance, entropy, composite) | ✓ (subset) | ✓ (full) |
| **Multi-round TaCo consensus** | Agents share rationale and revote until convergence | — | ✓ |
| **Stigmergic confidence** | Pheromone-based coordination with evaporation/decay | — | ✓ |
| **Agent antibodies** | Runtime output pattern scanning — reject, warn, quarantine | — | ✓ |
| **Basic observability** | Span tracing, cost tracking, collector hooks (in-memory) | ✓ | ✓ |
| **Trust registry** | Trusted-traveler lanes, configurable scan depth per agent | — | ✓ |
| **Change-kernel** | Approval workflows, escalation, merge, classification | — | ✓ (full) |

> `@symplek/core` ships coherence, confidence, and Teams at the root under MIT. `@symplek/pro` re-exports the complete modules from `@symplek/core` through the license gate alongside its own additions (TaCo, stigmergy, antibodies, trust).

---

## When you need pro

**Your agents need to reach agreement over multiple rounds.**
Single-round consensus (free) votes once. TaCo iterates — agents see each other's rationale, revise their votes, and converge. Use when a single-pass vote produces low-confidence or unstable outcomes.

**You need to catch bad outputs before they propagate.**
Agent antibodies scan every result against a registry of regex, substring, and structural matchers. Block XSS patterns, hallucinated field names, schema violations, or any custom pattern before it reaches downstream consumers.

**You need trust-based routing.**
Tag agents or callers with trust levels and expiration. Route deeper, more expensive analysis only when trust score warrants it.

---

## TaCo consensus example

```typescript
import { AgentUnit, createContext } from "@symplek/core";
import { tacoConsensus } from "@symplek/pro";

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
import { AntibodyRegistry } from "@symplek/pro";

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

## Observability

Basic observability is included in `@symplek/core` and works without a pro license. Import from `@symplek/core`:

```typescript
import { createOperatorSpan, getTraces, configureObservability } from "@symplek/core";

configureObservability({ verbosity: "detailed" });

const span = createOperatorSpan("llm", "generate");
span.setAttribute("model", "gpt-4o");

const output = await runMyAgent();

span.end({ tokens: output.usage?.totalTokens });

const traces = getTraces();
console.log(traces[0].durationMs);
```

Valid verbosity values: `"minimal"` | `"detailed"` | `"full"`.

---

## Upgrade path

Already using `@symplek/core`? Add `@symplek/pro` alongside it — no breaking changes.

```bash
# Add pro without removing core
pnpm add @symplek/pro
```

Import pro features directly alongside your existing `@symplek/core` imports:

```typescript
import { AgentUnit, createContext } from "@symplek/core"; // unchanged
import { tacoConsensus, AntibodyRegistry } from "@symplek/pro"; // additive
```

---

## License

BUSL-1.1 — see [LICENSE](LICENSE) for full terms. The license converts to MIT on 2030-04-13.
