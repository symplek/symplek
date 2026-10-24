# @symplek/pro

**Multi-round consensus, stigmergic confidence, output screening and trust lanes for multi-agent systems.**

> **Status: Experimental**: All exports produce real, testable behavior. No production consumers yet. Treat the API surface as unstable until 1.0.0 stable.

---

## A license key is required before import

`@symplek/pro` checks for a license key when the package is first loaded. Set it in the environment before your application starts:

```bash
export SYMPLEK_PRO_LICENSE_KEY="symplek_pro_<40 lowercase hex chars>"
```

Without it, `import "@symplek/pro"` (or `require`) throws. The environment variable is the only way to supply the key: the check runs at import, so no function from the package can be called first.

Today the check is on the key's format only (`symplek_pro_` followed by 40 lowercase hex characters). There is no signature, expiry or network lookup.

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

Four things live only in `@symplek/pro`:

| Feature | Description |
|---|---|
| **Multi-round TaCo consensus** (`tacoConsensus`) | Agents share rationale and revote until they converge |
| **Stigmergic confidence** (`ConfidentStigmergyLayer`) | Pheromone-style coordination with evaporation and decay |
| **Agent antibodies** (`AntibodyRegistry`) | Scans agent output against registered patterns: reject, warn or quarantine |
| **Trust registry** (`TrustRegistry`) | Trusted-traveler lanes with a configurable scan depth per agent |

Everything else is already in `@symplek/core` under MIT and needs no license key: `AgentUnit` and its operators, single-round consensus, teams, the solo gate, coherence, confidence, interview, change-kernel, contracts and observability.

`@symplek/pro` re-exports the coordination modules from `@symplek/core` unchanged (teams, solo, coherence, confidence, interview, change-kernel, contracts and the coordination operators). Importing them from `@symplek/pro` puts them behind the license check, so if those are all you need, import from `@symplek/core`. `AgentUnit`, `createContext` and observability are not re-exported; always import them from `@symplek/core`.

---

## When you need pro

**Your agents need to reach agreement over multiple rounds.**
Single-round consensus (free) votes once. TaCo iterates: agents see each other's rationale, revise their votes, and converge. Use when a single-pass vote produces low-confidence or unstable outcomes.

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

Already using `@symplek/core`? Add `@symplek/pro` alongside it: no breaking changes.

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

BUSL-1.1: see [LICENSE](LICENSE) for full terms. The license converts to MIT on 2030-04-13.
