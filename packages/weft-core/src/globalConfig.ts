/**
 * @module globalConfig - Process-level singleton for Symplek.configure() options.
 * @description Thin shared module so facade.ts, ai.ts, and providers/auto.ts can
 *   share global configuration state without creating circular imports.
 *   facade.ts writes; ai.ts and providers/auto.ts read.
 * @internal — not part of the public API surface.
 */

export interface SymplekGlobalConfig {
  provider?: string;
  model?: string;
  apiKey?: string;
  debug?: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Global config singleton
// ─────────────────────────────────────────────────────────────────────────────

let _config: SymplekGlobalConfig = {};

/** Read the current global config. */
export function getGlobalConfig(): Readonly<SymplekGlobalConfig> {
  return _config;
}

/**
 * Merge new values into the global config (second call wins per field).
 *
 * N67 safety: when `provider` is set (or changed) and `apiKey` is NOT present
 * in the incoming options object, any existing `apiKey` is cleared.  This
 * prevents the new vendor's adapter from being bootstrapped with a key that
 * was staged for a different (or no) provider.
 *
 * The guard fires whenever `options.provider` differs from `_config.provider`,
 * including the common sequence `configure({apiKey})` → `configure({provider})`
 * where `_config.provider` was previously undefined.
 *
 * Callers that change provider must supply the new `apiKey` in the same call,
 * or call `configure({ apiKey })` as a follow-up before any `ai()` call.
 */
export function mergeGlobalConfig(options: SymplekGlobalConfig): void {
  const providerChanging =
    options.provider !== undefined &&
    options.provider !== _config.provider;

  _config = { ..._config, ...options };

  // When the provider changes without an explicit new apiKey, delete the
  // stale key so no bootstrap fires for the new vendor with the old secret.
  if (providerChanging && !("apiKey" in options)) {
    delete _config.apiKey;
  }
}

/** Reset config to empty. Used in tests via facade._resetForTesting(). */
export function resetGlobalConfig(): void {
  _config = {};
}

// ─────────────────────────────────────────────────────────────────────────────
// Init-promise slot (OQ-1 resolution from wave-0-design.md)
//
// configure() stays void/synchronous by storing async bootstrap work here.
// ai() reads and awaits before executing, then clears the slot.
// Both facade.ts and ai.ts import from this module — no circular dependency.
// ─────────────────────────────────────────────────────────────────────────────

let _initPromise: Promise<void> | null = null;

/** Returns the pending init promise, or null if none is queued. */
export function getInitPromise(): Promise<void> | null {
  return _initPromise;
}

/** Store a new init promise (set by configure()). */
export function setInitPromise(p: Promise<void>): void {
  _initPromise = p;
  // The failure is delivered to whichever call awaits it (awaitInit below).
  // Without a handler here, a failed bootstrap that no call ever awaits
  // would end the process as an unhandled rejection.
  p.catch(() => {});
}

/**
 * Wait for the provider bootstrap that configure() started, if one is
 * pending. The promise is taken before it is awaited, so a failed bootstrap
 * is reported to this caller once and cannot poison every later call.
 */
export async function awaitInit(): Promise<void> {
  const pending = _initPromise;
  if (!pending) return;
  _initPromise = null;
  await pending;
}

/** Clear the init promise after ai() has awaited it. */
export function clearInitPromise(): void {
  _initPromise = null;
}

/** Reset everything — called by _resetForTesting() in facade.ts. */
export function resetAll(): void {
  _config = {};
  _initPromise = null;
}
