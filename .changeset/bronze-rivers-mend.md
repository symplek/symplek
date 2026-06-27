---
"weft-core": patch
---

Wire `Weft.configure()` global config into `ai()` and provider detection (was a silent no-op). Redact API keys from `error.cause` (not just `error.message`) to close the secret-leak path. Replace all key occurrences in redaction (not just first). Return provider-appropriate default models from `selectModelForTask()` instead of hardcoded OpenAI strings. Recover Anthropic streaming usage metadata so token totals are accurate. Dynamic provider SDK imports in `weft-core/server` so only the provider in use must be installed. Thread schema generic through the builder to preserve `TrackedResult<T>`. Split `operators.ts` into domain sub-modules to stay under the 1000-LOC ceiling.
