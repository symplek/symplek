# Step Beyond behavioural cases — private Symplek experiment

**Branch / worktree:** `experiment/step-beyond-behavioural-cases` at
`/mnt/c/Gits/symplek-step-beyond-experiment` (base commit `4da19c2`).
Main checkout `/mnt/c/Gits/wefthq-weft` untouched.

**Question:** Do the two Step Beyond-inspired behavioural cases — (A) strict scope /
no unsolicited extras, (B) partial verification / no full-claim overstatement — reveal
a capability Symplek is *missing*? Or are they already expressible with Symplek's existing
deterministic harness/test surface, with no new production code?

**Verdict: KILL.** Both cases are already expressible and green using existing Symplek
mechanisms, with zero production changes. The only increment Step Beyond would add is
*semantic / LLM-judged* scope and claim checking, which the experiment's own kill rule
forbids (new runtime / prompt / judge layer).

---

## Baseline: the mechanisms already in the repo

Two enforcement gates already ship in `@symplek/harness`, both exercised by the existing
test suite (`contract-validation.test.ts`, `provenance.test.ts`):

1. **Action-level scope gate — `buildPermissionBridge`** (`src/permission-bridge.ts`).
   `execute()` builds a `canUseTool` bridge from the `VerifiedPlan`. Any tool not in
   `plan.requiredTools`, any file path not in a step's `targetPath`, and any shell tool
   without explicit opt-in throws `HarnessDeviationError` *before* the side effect lands.
   This is precisely "do only what was planned, nothing extra."

2. **Output-contract gate — `expectedOutput.parse()`** (`src/operators/execute.ts`,
   lines 177-197). After the session ends, `execute()` runs the plan's duck-typed
   `expectedOutput.parse(finalMessage)` and throws `ContractViolationError` on rejection.
   The schema receives the agent's **final message string**, so it can assert arbitrary
   content constraints — including "this completion claim is not overstated."

Neither case needs a new store, hook, prompt layer, adapter, or public API. Case A maps
onto gate (1); case B maps onto gate (2). Both gates already have passing tests.

### Case A — strict scope / no unsolicited extras → **already expressible**
`buildPermissionBridge` already blocks unauthorized tools and paths. A plan that
authorises one `Edit` to `src/target.ts` will reject an agent that also `Write`s an
undeclared file or reaches for an undeclared `Bash`. No gap.

### Case B — partial verification / no full-claim overstatement → **already expressible**
The `expectedOutput` contract hook already validates the final message. A claim-scoped
verifier schema (2 of 5 done) accepts an accurate partial claim and rejects an overstated
"all 5 fully migrated" claim via `ContractViolationError`. No gap.

---

## Changed files (this worktree)

Tests only — no production code touched:

- `packages/symplek-harness/src/__tests__/step-beyond-strict-scope.test.ts` (new)
- `packages/symplek-harness/src/__tests__/step-beyond-partial-verification.test.ts` (new)
- `EXPERIMENT.md` (this file)

Both tests import only pre-existing exports (`execute`, `HarnessDeviationError`,
`ContractViolationError`, `VerifiedPlan`, `SdkSession`, `createContext`). They are
baseline probes: green tests here are *evidence that the cases are already expressible*,
not a new feature.

---

## Commands & results

```
# scope: two new probe files + full existing harness suite (regression guard)
node_modules/.bin/vitest run --root packages/symplek-harness

# typecheck the changed surface
node_modules/.bin/tsc -p packages/symplek-harness/tsconfig.json --noEmit

# whitespace / conflict-marker gate
git diff --check
```

Results:

- `pnpm install --frozen-lockfile` → completed without changing the lockfile. Dependencies were installed only in this private worktree.
- `pnpm --filter @symplek/core run build` → passed. The declaration build emitted an existing circular-chunk warning around `ObjectiveConfidence`, but completed successfully.
- `pnpm --filter @symplek/harness test` → passed: **7 test files, 36 tests**. This includes all six new probe assertions.
- `pnpm --filter @symplek/harness exec tsc -p tsconfig.json --noEmit` → passed with no output after the workspace build.
- `git diff --check` → clean. The only tracked working changes are the two new probe files and this experiment record.

The first direct binary attempt failed because the fresh worktree had no installed dependencies. After an immutable-lockfile install and the required `@symplek/core` build, the harness resolved the workspace export and all focused checks ran successfully.

---

## Was a real gap found?

**No.** Neither case exposes a missing deterministic capability.

- Case A is enforced today by the permission bridge (action-level scope).
- Case B is enforced today by the output-contract gate (claim-scoped schema).

The *only* thing Step Beyond would add on top is **semantic** judgement:
- Case A': over-delivery *within* an allowed path (e.g. refactoring an unrelated function
  in the same authorised file) — path-gating can't see this.
- Case B': deciding whether a natural-language claim is "overstated" in general, rather
  than against a caller-supplied schema — needs an LLM judge.

Both of those require a new prompt/judge runtime, which is exactly what the experiment's
kill rule prohibits and what the Step Beyond analysis already concluded (NO PORT). They
are also not deterministic-replay's strength — Symplek's differentiator is *reproducible
recorded replay*, which both existing gates already fit into (record once, replay in CI).

## Maintenance cost

If kept, the two probe tests cost ~2 small vitest files with no production dependency —
essentially free. But they document existing behaviour rather than guard a new capability,
so their value is as evidence for this experiment, not as long-term regression guards
beyond what `contract-validation.test.ts` / `permission-bridge` coverage already provide.

## Decision

**KILL.** Do not integrate anything into `@symplek/*` production code. The branch is left in
place as evidence per the acceptance criteria. No new runtime, store, hook, prompt layer,
dependency, or public API was introduced or is warranted.
