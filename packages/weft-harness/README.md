# @symplek/harness

Algebraic trust layer that lifts agent SDK calls into Symplek's `AgentUnit<T>` algebra.

**Status: pre-alpha. No agent SDK is wired yet. Every result this package produces today is a stand-in. The `plan()`, `execute()`, and `session()` operators work, but they run stub sessions: no real agent executes. This is documented per operator below.**

**ESM only. `require("@symplek/harness")` will throw.**

**Pre-1.0. The API will move.**

---

## Install

```bash
pnpm add @symplek/harness @symplek/core
```

No vendor SDK installation is required or useful today. The adapters will wire to vendor SDKs in a future release; install instructions will appear when that wiring exists.

---

## What it does

`@symplek/harness` lifts agent SDK calls into `AgentUnit<T>` so every Symplek operator (`retry`, `timeout`, `fallback`, `consensus`, `zip`) works on them. The package today provides:

- `createHarness(options)`: creates a harness instance
- `harness.plan(intent)`: produces a `PlanArtifact` (stub: synthesized from declared tools, no real read executes)
- `harness.session(prompt)`: runs a session in `bypassPermissions` mode (stub: returns a stand-in message)
- `harness.execute(verifiedPlan)`: runs a verified plan in `acceptEdits` mode with the permission bridge applied (stub: returns a stand-in message)
- `buildPermissionBridge(verifiedPlan)`: the path and tool gate, usable standalone
- `ReplayAdapter`: replay recorded traces without live API calls; use with `execute()`

---

## Trust labels in default mode

`AgentUnit.run(ctx)` (zero-trust / default mode) wraps the operator's output in a `TrackedResult<T>`. Because no SDK is wired, the inner operator result always has `source: "synthesized"`. The outer framework envelope has `source: "agent"`: this is the AgentUnit wrapper, not a claim that an agent ran.

To inspect the honest inner label:

```typescript
const result = await harness.execute(verifiedPlan).run(ctx);
// result.source    → "agent"  (AgentUnit framework wrapper)
// result.value.source → "synthesized"  (honest: stub ran, not a real SDK)
```

In legacy mode (`trustMode: "legacy"`, deprecated, will be removed in v3), `.run()` returns the inner `TrackedResult` directly so `result.source === "synthesized"`.

---

## Usage

```typescript
import { createContext } from "@symplek/core";
import { createHarness } from "@symplek/harness";

const harness = createHarness({ adapter: "claude-agent-sdk", tools: ["Read", "Grep"] });
const ctx = createContext();

// plan() returns AgentUnit<PlanArtifact>
// result.value is the PlanArtifact: result.value.id is the SHA-256 plan ID
const planResult = await harness.plan("summarise this codebase")
  .retry(2)
  .timeout(120_000)
  .run(ctx);
console.log(planResult.value.id); // SHA-256 plan ID
console.log(planResult.value.synthesized); // true: no SDK wired yet

// session() takes a prompt string, returns AgentUnit<TrackedResult<string>>
const sessionResult = await harness.session("list all TODO comments")
  .timeout(60_000)
  .run(ctx);
// sessionResult.value.source === "synthesized" (stub: no SDK wired)

// execute() takes a VerifiedPlan built via the consensus/verify step
// It does NOT take a raw prompt or PlanArtifact; it requires a VerifiedPlan.
// See the VerifiedPlan type for the expected shape.
```

---

## Permission bridge

`buildPermissionBridge(verifiedPlan)` returns a `canUseTool` gate that:

- Blocks any tool not listed in `verifiedPlan.plan.requiredTools`
- Blocks shell tools (`Bash`, `sh`, `PowerShell`, `local_shell`, etc.) unless `allowShell: true` is passed to `buildPermissionBridge` or to `execute()` via `options.allowShell`
- Path-gates file tools (`Read`, `Glob`, `Grep`, `Edit`, `Write`, `str_replace_editor`, etc.) against `verifiedPlan.plan.steps[*].targetPath`: every path argument is checked, including secondary fields like `glob` and `pattern`
- Rejects absolute paths even when the relative remainder matches an allowed path

---

## Replay

```typescript
import { execute } from "@symplek/harness";
import { ReplayAdapter } from "@symplek/harness/replay";

// ReplayAdapter satisfies SdkSession: pass it to execute() with isStub:true
// (the default) so results are labelled source:"synthesized", not "verified".
const adapter = new ReplayAdapter({ tracePath: "traces/session.jsonl" });
const result = await execute(adapter, verifiedPlan).run(ctx);
// result.value.source === "synthesized": replay is not a live execution
```

---

## Provenance gates

`requireMinChainConfidence(threshold)` on `PlanUnit` rejects synthesized plans unconditionally: their sources are heuristic estimates, not real execution records. A real SDK session must run `plan()` for the gate to pass:

```typescript
// Throws LowProvenanceError when no SDK is wired (synthesized plan)
await harness.plan("intent").requireMinChainConfidence(0.8).run(ctx);
```

---

## License

MIT
