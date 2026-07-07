/**
 * @fileoverview Weft Pro License Gate — FATAL #6 HARDENING (2026-07-07)
 *
 * This module enforces license validation BEFORE any Pro feature code executes.
 * It is imported by every Pro feature module, ensuring no path into Pro
 * functionality bypasses the gate — even direct imports of sub-modules.
 *
 * Architecture:
 * - `requireLicense()` is called at module scope in this file
 * - Every feature module imports this file as `import './license-gate'`
 * - Node.js module caching ensures the gate only executes once
 * - The import side-effect is NOT strippable by bundlers (unlike a bare statement)
 * - `validateLicense()` and `isProLicensed()` are exported for the public API
 *
 * @module weft-pro/license-gate
 * @since 1.0.0-beta.2 — License-gated at module level
 */

const LICENSE_ENV_VAR = "WEFT_PRO_LICENSE_KEY";

let _licenseValidated = false;
let _licenseKey: string | null = null;

/**
 * Validate a Weft Pro license key.
 *
 * Called automatically on module load if WEFT_PRO_LICENSE_KEY is set.
 * Otherwise, consumers must call this before using any Pro features.
 *
 * @throws {Error} if the key is invalid or expired
 */
export function validateLicense(key?: string): void {
  // If already validated and no new key is passed, skip re-validation
  if (_licenseValidated && !key) return;

  const effectiveKey = key ?? process.env[LICENSE_ENV_VAR] ?? null;

  if (!effectiveKey || effectiveKey.trim().length === 0) {
    throw new Error(
      "Weft Pro requires a valid license key. " +
        `Set ${LICENSE_ENV_VAR} or call validateLicense(key). ` +
        "Get a key at https://weft.gg/pro",
    );
  }

  // Phase 1: format validation only (server-side validation post-launch)
  // Accepts keys matching: weft_pro_XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
  // where X is [a-f0-9] (40 hex chars = 20 bytes of entropy)
  const KEY_PATTERN = /^weft_pro_[a-f0-9]{40}$/;
  if (!KEY_PATTERN.test(effectiveKey.trim())) {
    throw new Error(
      "Invalid Weft Pro license key format. " +
        "Expected: weft_pro_<40 hex chars>. Got: " +
        `${effectiveKey.slice(0, 20)}...`,
    );
  }

  _licenseKey = effectiveKey.trim();
  _licenseValidated = true;
}

/**
 * Returns true if a valid Pro license has been validated.
 * Does not throw — safe for feature-flag checks.
 */
export function isProLicensed(): boolean {
  return _licenseValidated;
}

/**
 * Guard: throws if license is not validated.
 * Called at module scope below.
 */
function requireLicense(): void {
  if (!_licenseValidated) {
    throw new Error(
      "Weft Pro features require a valid license. " +
        `Call validateLicense(key) or set ${LICENSE_ENV_VAR}. ` +
        "Get a key at https://weft.gg/pro",
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// AUTO-VALIDATE ON MODULE LOAD (if env var set)
// ─────────────────────────────────────────────────────────────────────────────

try {
  if (process.env[LICENSE_ENV_VAR]) {
    validateLicense();
  }
} catch {
  // Suppress auto-validation errors — consumers must call validateLicense()
  // explicitly if they want the error to propagate
}

// ═══════════════════════════════════════════════════════════════════════════════
// LICENSE GATE — enforced at module load, before any importing module executes
// ═══════════════════════════════════════════════════════════════════════════════
requireLicense();
