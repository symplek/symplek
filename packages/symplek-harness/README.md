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
// result.source       → "agent"       (AgentUnit framework wrapper, always)
// result.value.source → "synthesized" (honest: stub ran, not a real SDK)
```

In legacy mode (`trustMode: "legacy"`, deprecated, will be removed in v3), `.run()` returns the inner `TrackedResult` directly so `result.source === "synthesized"`.

The `execute()` and `session()` operators treat a session as a stand-in unless they are told otherwise (`{ isStub: false }`), so a caller who labels nothing gets `"synthesized"` on that inner result, never `"verified"` or `"agent"`. A plan carries its own `synthesized: true` flag for the same reason.

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

- Blocks any tool not listed in `verifiedPlan.plan.requiredTools` (fail-closed for unknown tools)
- Blocks shell tools (`Bash`, `sh`, `PowerShell`, `local_shell`, etc.) unless `allowShell: true` is passed to `buildPermissionBridge` or to `execute()` via `options.allowShell`
- Path-gates file tools (`Read`, `Glob`, `Grep`, `Edit`, `Write`, `str_replace_editor`, etc.) against `verifiedPlan.plan.steps[*].targetPath`. Every path-shaped argument on a call is checked, not only the first.
- Treats the two search arguments that are not paths for what they are. A glob that chooses files under the search root (`pattern` on `Glob`, `glob` on `Grep`) has to be a plain glob: names made of ASCII letters, digits, `_`, `*` and `?` (with `-` allowed after a name's first character), single dots between names, and `/` between segments. `**/*.ts`, `src/**/*.test.ts` and `*.d.ts` are plain globs. Everything else is refused, including braces, character classes, backslashes, `~`, a leading `/`, `..`, and a segment that starts with a dot. That is much less than glob syntax, on purpose: nothing in a plain glob can expand into a path outside the search root. The cost is that `*.{ts,tsx}` takes two searches and hidden files such as `.env*` cannot be selected by glob. One limit to know: the check reads the glob's text. It assumes the search engine behind it never matches the directory entries `.` and `..` with a wildcard, which is how glob engines behave unless set up otherwise; an adapter that wires in an engine set up otherwise has to check the paths it gets back. Symbolic links are the same kind of limit: a link under the root can point outside it, and whether a search follows links is up to the engine. The regular expression `Grep` matches against file contents (`pattern`) is not inspected, because it cannot change where the search looks.
- Rejects a search with no search root (`path`): it would be a search of everything
- Rejects absolute paths (`/...`, `C:\...`) in requested arguments. Declared `targetPath` values that are absolute are rejected at bridge-build time so a plan can never silently authorise a different file from the one written in it.
- Passes `WebSearch` and `WebFetch` through after the `requiredTools` check with no further argument inspection. The bridge does NOT gate network access; listing these tools in `requiredTools` is the only control the bridge applies to them.
- Refuses any tool the gate does not recognise, even if listed in `requiredTools`

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

A trace file is appended to on every recorded run. `ReplayAdapter` replays the run the file ends with. A run that failed leaves its entries with no closing `SessionEnd` line, and a trace that ends that way, or is empty, is refused with `ReplayIncompleteError`: there is no outcome to hand back.

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
