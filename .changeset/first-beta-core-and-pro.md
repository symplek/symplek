---
"@symplek/core": patch
"@symplek/pro": patch
---

First public beta. Everything since the internal `1.0.0-beta.1` milestone, which was never published.

**@symplek/core, added**

- OpenTelemetry export: `configureOpenTelemetry()`, `exportTraces()` and `shutdownOpenTelemetry()` emit spans with `gen_ai.*` attributes. The OTel packages are optional peer dependencies.
- `.reflect()` operator for critique and improvement loops driven by agents you supply.
- Idempotency keys on `AgentUnit.run()` with an injectable `IdempotencyStore`. Concurrent runs on the same key execute once. If the work succeeds but the store write fails, the run raises `IdempotencyStoreWriteError` instead of inviting a retry. At-most-once holds while the store is available.
- Subpath exports: `@symplek/core/confidence`, `/coherence`, `/interview`, `/change-kernel`, `/operators` and `/rehearsal`.
- `converge` accepts `mergeStrategy: "last" | "reduce"`.
- Provider SDKs load on first use, so `@symplek/core/server` only needs the SDK for the provider you call. A missing SDK raises a `PROVIDER_ERROR` naming the package to install.

**@symplek/core, fixed**

- `Symplek.configure()` now takes effect (it was a silent no-op). It falls back to the provider's conventional environment variable when no `apiKey` is given, never pairs a key with a provider it was not supplied for, and a newer call supersedes an older bootstrap still in flight.
- API keys are removed from error messages and from the attached `cause`, in every occurrence.
- Default model selection follows the provider actually in use, so Anthropic and Google callers no longer receive OpenAI model ids.
- Anthropic streaming reports accurate token totals.
- Options that were accepted and ignored now apply: `timeout` and `retry` when a schema is given, `provider`, `system` and `temperature` on `Symplek.agent`, `SymplekOptions.confidence`, and `StreamOptions.signal`.
- Consensus cancels losing voters when a vote times out and does not start work for a caller that has already cancelled.
- Compensation and saga rollback report every failed undo, not only the first.
- Interview converges: answers populate the context, corrections replace earlier answers, and extraction validates against the schema. Creating an interview without a `contextSchema` throws.
- Replay fails on real divergence. A tampered output, a response-text change and a non-deterministic agent are each detected.
- Consultation enforces its latency budget while a specialist is running and no longer drops unavailable required specialists silently.
- Lock `extend()` writes a new entry, and in-memory lock state is per instance.
- Traces are no longer handed between concurrent callers through process-global state, and what is recorded matches the documented contract.
- `retry(0)`, non-finite vote confidences and non-positive round limits fail early or are clamped instead of propagating `undefined` or `NaN`.
- `sanitizeContext` handles circular objects and redacts inside arrays.

**@symplek/core, changed**

- `TrackedResult` values cannot be forged by constructing a look-alike object.
- Schema introspection uses Zod's public API only.
- `openrouter` is not offered as a provider until it has a working adapter.
- The in-memory idempotency cache expires entries after one hour by default.

**@symplek/pro**

- Confidence, coherence, change-kernel, interview and the operators now re-export `@symplek/core` behind the license gate, replacing copies that had drifted from it.
- TaCo consensus treats agreement as voters agreeing with each other, so a unanimous rejection converges.
- The antibody scanner gives the same verdict on the same input when a pattern carries the `g` flag.
- Stigmergy rejects evaporation rates that produced `NaN` confidence.
- The trust registry returns copies, so inspecting a grant cannot change it.
- A `test` script so the package's suite runs in CI.
