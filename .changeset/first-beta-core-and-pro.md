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
- Zod 4 is supported alongside Zod 3. The `zod` peer range is `^3.25.28 || ^4.0.0`.

**@symplek/core, fixed**

- `Symplek.configure()` now takes effect (it was a silent no-op). It falls back to the provider's conventional environment variable when no `apiKey` is given, never pairs a key with a provider it was not supplied for, and a newer call supersedes an older bootstrap still in flight.
- A provider API key in the environment is enough to run. `ai()`, `Symplek()`, `stream()` and agents (`Symplek.agent()`) load the matching provider on first use with no `configure()` call. Reaching for a second provider by id does not change the default one.
- `ai(prompt, { schema })` tells the model the schema. The JSON Schema for the Zod type is sent with the request, where before the model was asked for JSON and never shown the fields.
- Schemas with arrays, enums, unions, literals and nullable fields are converted in full. The previous converter dropped every field that was not a string, number, boolean or object.
- The Anthropic adapter returns the answer when the reply begins with a thinking block, which is what current Claude models send. It used to return an empty string. Its default output cap is 16000 tokens, and a refusal is reported as a `content_filter` finish.
- A refused request, or one that spends its output limit before any answer is written, throws `PROVIDER_ERROR` from `ai()`, `Symplek()`, `stream()` and agents (`Symplek.agent()`). It used to come back as an empty string that read as a reply.
- Default models are current: `claude-opus-5-5`, `claude-sonnet-5-5` and `claude-haiku-5-5` for Anthropic, `gemini-3.8-flash` and `gemini-3.5-flash-lite` for Google, `gpt-4o` and `gpt-4o-mini` for OpenAI. The previous Google defaults and the Anthropic fast default were ids the providers no longer serve.
- `require("@symplek/core")` and `require("@symplek/core/server")` share one copy of the code. Each CommonJS entry point used to carry its own, so a provider configured through one was invisible to the other.
- Each module format has its own type declarations, so a CommonJS project under `node16` resolution type-checks.
- Coordination operators no longer print the legacy-mode deprecation warning for callers who never chose legacy mode.
- API keys are removed from error messages and from the attached `cause`, in every occurrence.
- Default model selection follows the provider actually in use, so Anthropic and Google callers no longer receive OpenAI model ids.
- Anthropic streaming reports accurate token totals.
- Options that were accepted and ignored now apply: `timeout` and `retry` when a schema is given, `provider`, `system` and `temperature` on `Symplek.agent`, `SymplekOptions.confidence`, and `StreamOptions.signal`.
- Consensus cancels losing voters when a vote times out and does not start work for a caller that has already cancelled.
- Compensation and saga rollback report every failed undo, not only the first.
- Interview converges: answers populate the context, corrections replace earlier answers, and extraction validates against the schema. Creating an interview without a `contextSchema` throws.
- Replay reports a tampered trace. An edited event throws `ReplayDivergenceError`, and an edited output comes back with `matched: false`.
- A recorded model call stores the hash that replay compares it against, so replaying an unchanged call no longer logs a mismatch.
- Consultation enforces its latency budget while a specialist is running and no longer drops unavailable required specialists silently.
- Lock `extend()` writes a new entry, and in-memory lock state is per instance.
- Traces are no longer handed between concurrent callers through process-global state, and what is recorded matches the documented contract.
- `retry(0)`, non-finite vote confidences and non-positive round limits fail early or are clamped instead of propagating `undefined` or `NaN`.
- `sanitizeContext` handles circular objects and redacts inside arrays.

**@symplek/core, changed**

- `TrackedResult` values cannot be forged by constructing a look-alike object.
- `zod-to-json-schema` is a runtime dependency. It converts Zod 3 schemas; Zod 4 schemas use Zod's own converter.
- The debug cost line prints an estimate only for models with a known list price, and no figure otherwise.
- `openrouter` is not offered as a provider until it has a working adapter.
- The in-memory idempotency cache expires entries after one hour by default.

**@symplek/pro**

- Confidence, coherence, change-kernel, interview and the operators now re-export `@symplek/core` behind the license gate, replacing copies that had drifted from it.
- Importing without a license key fails with an error that names the one thing that fixes it: set `SYMPLEK_PRO_LICENSE_KEY` before the import. A malformed key gets its own error, which no longer echoes part of the key.
- TaCo consensus treats agreement as voters agreeing with each other, so a unanimous rejection converges.
- The antibody scanner gives the same verdict on the same input when a pattern carries the `g` flag.
- Stigmergy rejects evaporation rates that produced `NaN` confidence.
- The trust registry returns copies, so inspecting a grant cannot change it.
- `@symplek/core` is a caret peer range, where it used to pack as an exact version pin.
- A `test` script so the package's suite runs in CI.
