/**
 * @module providers/redact - Secret-redaction helpers shared by all provider adapters.
 *
 * Provider SDK errors (Anthropic/OpenAI/Google) routinely embed the raw API key
 * in `error.message` AND in nested request-header objects reachable via
 * `error.cause`. `console.error`, `util.inspect`, and error reporters (Sentry et
 * al.) walk `.cause`, so retaining the raw SDK error leaks the key even when the
 * surfaced message has been scrubbed.
 *
 * These helpers (a) globally replace every occurrence of the key in a string and
 * (b) drop the SDK `cause` entirely. Dropping is deliberately chosen over partial
 * header-walking: a full deep-redact would have to enumerate every shape the SDKs
 * use (headers, request objects, response bodies, nested causes) and would still
 * miss the next SDK revision. Dropping closes the util.inspect/.cause vector
 * outright while preserving the redacted, human-readable message in `why`.
 */

/** Sentinel substituted in place of a redacted secret. */
export const REDACTED = "[REDACTED]";

/**
 * Env var names that hold provider API keys. Used as a defense-in-depth backstop
 * so a leak path that lacks an explicit key reference (e.g. the ai.ts
 * UNKNOWN_ERROR catch) still scrubs the configured keys. A short minimum length
 * guards against a misconfigured/empty env var matching everything.
 */
const KEY_ENV_VARS = [
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "GOOGLE_GENERATIVE_AI_API_KEY",
] as const;
const MIN_ENV_KEY_LEN = 12;

/**
 * Replace EVERY occurrence of `key` in `str` with the redaction sentinel.
 *
 * `String.prototype.replace(string, …)` only replaces the first match, so a key
 * that appears twice (e.g. once in the message and once in an embedded URL) would
 * leak the second copy. `split(key).join(REDACTED)` is a literal global replace
 * with no regex-escaping concerns.
 *
 * @param key - The secret to scrub. Falsy keys are treated as "nothing to redact".
 * @param str - The string to scrub. Non-string / nullish input returns `""`.
 */
export function redactKey(key: string | undefined | null, str: unknown): string {
  const text = typeof str === "string" ? str : str == null ? "" : String(str);
  if (!key) return text;
  return text.split(key).join(REDACTED);
}

/**
 * Backstop scrub: redact any configured provider key present in the process env.
 *
 * The explicit `redactKey` path handles the precise adapter case where the key
 * is in scope. This covers the cases where it is NOT — e.g. the ai.ts backstop
 * catches a raw error with no key reference. We scrub the live env key values so
 * a key never escapes even when the caller couldn't pass it. No-op in
 * environments without `process` (browser bundle).
 */
export function redactEnvKeys(str: unknown): string {
  let text = typeof str === "string" ? str : str == null ? "" : String(str);
  const env =
    typeof process !== "undefined" && process?.env ? process.env : undefined;
  if (!env) return text;
  for (const name of KEY_ENV_VARS) {
    const value = env[name];
    if (value && value.length >= MIN_ENV_KEY_LEN && text.includes(value)) {
      text = text.split(value).join(REDACTED);
    }
  }
  return text;
}

/**
 * Build a redacted detail string from a thrown provider error.
 *
 * Centralises the `error.message ?? String(error)` extraction so every catch
 * block scrubs identically.
 */
export function redactErrorMessage(
  key: string | undefined | null,
  error: unknown,
): string {
  const raw =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : error == null
          ? ""
          : String(error);
  // Scrub the explicit key first (precise path), then env keys as a backstop for
  // callers that have no key reference (e.g. the ai.ts UNKNOWN_ERROR catch).
  return redactEnvKeys(redactKey(key, raw));
}

/**
 * Cause value attached to a `WeftError` for a provider SDK failure.
 *
 * We deliberately DO NOT forward the raw SDK error object — it carries the API
 * key inside request headers (`Authorization: Bearer …`) reachable via
 * `util.inspect`/`.cause` walkers. Instead we return a flat, key-free summary so
 * the error code/type is still observable for programmatic handling without any
 * secret-bearing surface.
 *
 * @param key - The secret to scrub from any retained string fields.
 * @param error - The raw SDK error being dropped.
 * @returns A plain object safe to attach as `cause`.
 */
export function safeCause(
  key: string | undefined | null,
  error: unknown,
): Record<string, unknown> {
  const name = error instanceof Error ? error.name : typeof error;
  // Capture a status code if the SDK exposes one (most do as `.status`), but
  // never the headers/request/response objects that carry the key.
  const status =
    error && typeof error === "object" && "status" in error
      ? (error as { status?: unknown }).status
      : undefined;

  const cause: Record<string, unknown> = {
    redacted: true,
    name,
    message: redactErrorMessage(key, error),
  };
  if (typeof status === "number" || typeof status === "string") {
    cause.status = status;
  }
  return cause;
}
