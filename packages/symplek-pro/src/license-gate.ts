/**
 * @fileoverview Symplek Pro License Gate — FATAL #6 HARDENING (2026-07-07)
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
 * The key can only be supplied through the SYMPLEK_PRO_LICENSE_KEY environment
 * variable, and it must be set before the package is first imported: the gate
 * runs when this module loads, so nothing exported from here can be called
 * until it has already passed.
 *
 * @module @symplek/pro/license-gate
 * @since 1.0.0-beta.1 — License-gated at module level
 */

const LICENSE_ENV_VAR = "SYMPLEK_PRO_LICENSE_KEY";

let _licenseValidated = false;
let _licenseKey: string | null = null;

/**
 * Validate a Symplek Pro license key.
 *
 * Called automatically on module load with SYMPLEK_PRO_LICENSE_KEY. Because the
 * gate below runs at module load, this function is only reachable once a key
 * has already been accepted; calling it with a key re-checks that key.
 *
 * The check is format-only (`symplek_pro_` followed by 40 lowercase hex
 * characters). No signature, expiry or server lookup is performed.
 *
 * @throws {Error} if the key is missing or malformed
 */
export function validateLicense(key?: string): void {
  // If already validated and no new key is passed, skip re-validation
  if (_licenseValidated && !key) return;

  const effectiveKey = key ?? process.env[LICENSE_ENV_VAR] ?? null;

  if (!effectiveKey || effectiveKey.trim().length === 0) {
    throw new Error(
      "Symplek Pro requires a license key. " +
        `Set the ${LICENSE_ENV_VAR} environment variable before importing @symplek/pro.`,
    );
  }

  // Phase 1: format validation only (server-side validation post-launch)
  // Accepts keys matching: symplek_pro_XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
  // where X is [a-f0-9] (40 hex chars = 20 bytes of entropy)
  const KEY_PATTERN = /^symplek_pro_[a-f0-9]{40}$/;
  if (!KEY_PATTERN.test(effectiveKey.trim())) {
    throw new Error(
      "Invalid Symplek Pro license key format. " +
        "Expected: symplek_pro_<40 lowercase hex chars>. " +
        `Check the value of ${LICENSE_ENV_VAR}.`,
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
    // Re-run validation so the caller sees the specific reason: the variable
    // is missing, or it is set but malformed.
    validateLicense();
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// LICENSE GATE — enforced at module load, before any importing module executes
// ═══════════════════════════════════════════════════════════════════════════════
requireLicense();
