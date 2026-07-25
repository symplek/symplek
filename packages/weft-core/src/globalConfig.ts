/**
 * @module globalConfig - Process-level singleton for Weft.configure() options.
 * @description Thin shared module so facade.ts, ai.ts, and providers/auto.ts can
 *   share global configuration state without creating circular imports.
 *   facade.ts writes; ai.ts and providers/auto.ts read.
 * @internal — not part of the public API surface.
 */

export interface WeftGlobalConfig {
  provider?: string;
  model?: string;
  apiKey?: string;
  debug?: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Global config singleton
// ─────────────────────────────────────────────────────────────────────────────

let _config: WeftGlobalConfig = {};

/** Read the current global config. */
export function getGlobalConfig(): Readonly<WeftGlobalConfig> {
  return _config;
}

/**
 * Merge new values into the global config (second call wins per field).
 *
 * N67 safety: when `provider` changes to a different vendor and `apiKey` is
 * NOT present in the incoming options object, the existing `apiKey` is cleared.
 * This prevents the new vendor's adapter from being bootstrapped with the
 * previous vendor's secret.
 *
 * Callers that change provider must supply the new `apiKey` in the same call,
 * or call `configure({ apiKey })` as a follow-up before any `ai()` call.
 */
export function mergeGlobalConfig(options: WeftGlobalConfig): void {
  const providerChanging =
    options.provider !== undefined &&
    _config.provider !== undefined &&
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
