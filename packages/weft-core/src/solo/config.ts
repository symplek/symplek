/**
 * @fileoverview Solo Mechanism Configuration
 * @description Default configuration and presets for solo execution
 * @module weft-core/solo/config
 * @since 1.0.0-beta.1
 *
 * 📝 BUILD[STORY-01.03]: Configuration and presets
 *
 * @remarks
 * Provides sensible defaults based on PRISM framework research and RAC algorithm.
 * Conservative defaults ensure safety; presets allow tuning per use case.
 */

import type { SoloConfig, SoloPreset } from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// DEFAULT CONFIGURATION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Default solo configuration values.
 * Based on research:
 * - PRISM framework: high confidence (>= 0.90) reduces error rate
 * - RAC algorithm: group alignment (>= 0.85) prevents divergence
 * - Conservative risk (<= 0.30) for autonomous actions
 */
export const SOLO_DEFAULTS: Required<
  Pick<
    SoloConfig,
    | "confidenceThreshold"
    | "coherenceThreshold"
    | "riskThreshold"
    | "lockTimeout"
  >
> = {
  confidenceThreshold: 0.9,
  coherenceThreshold: 0.85,
  riskThreshold: 0.3,
  lockTimeout: 30000, // 30 seconds
};

// ─────────────────────────────────────────────────────────────────────────────
// PRESET CONFIGURATIONS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Preset configurations for different risk tolerances.
 */
export const SOLO_PRESETS: Record<SoloPreset, SoloConfig> = {
  /**
   * Conservative preset (default).
   * Highest thresholds for maximum safety.
   * Use for: critical operations, production environments.
   */
  conservative: {
    confidenceThreshold: 0.95,
    coherenceThreshold: 0.9,
    riskThreshold: 0.2,
    lockTimeout: 30000,
  },

  /**
   * Standard preset.
   * Balanced thresholds for typical use cases.
   * Use for: development, staging, low-risk operations.
   */
  standard: {
    confidenceThreshold: 0.9,
    coherenceThreshold: 0.85,
    riskThreshold: 0.3,
    lockTimeout: 30000,
  },

  /**
   * Aggressive preset.
   * Lower thresholds for faster autonomous action.
   * Use with caution: testing, non-critical operations only.
   */
  aggressive: {
    confidenceThreshold: 0.8,
    coherenceThreshold: 0.7,
    riskThreshold: 0.5,
    lockTimeout: 15000,
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// CONFIGURATION HELPERS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Resolve a preset name to configuration values.
 *
 * @param preset - Preset name
 * @returns Configuration for the preset
 */
export function resolvePreset(preset: SoloPreset): SoloConfig {
  return SOLO_PRESETS[preset];
}

/**
 * Merge user config with defaults.
 *
 * @param config - User-provided config (may be partial)
 * @param preset - Optional preset to use as base
 * @returns Complete config with all values
 */
export function mergeConfig(
  config: SoloConfig = {},
  preset?: SoloPreset,
): Required<
  Pick<
    SoloConfig,
    | "confidenceThreshold"
    | "coherenceThreshold"
    | "riskThreshold"
    | "lockTimeout"
  >
> &
  SoloConfig {
  const base = preset ? SOLO_PRESETS[preset] : SOLO_DEFAULTS;

  return {
    ...base,
    ...config,
    confidenceThreshold:
      config.confidenceThreshold ??
      base.confidenceThreshold ??
      SOLO_DEFAULTS.confidenceThreshold,
    coherenceThreshold:
      config.coherenceThreshold ??
      base.coherenceThreshold ??
      SOLO_DEFAULTS.coherenceThreshold,
    riskThreshold:
      config.riskThreshold ?? base.riskThreshold ?? SOLO_DEFAULTS.riskThreshold,
    lockTimeout:
      config.lockTimeout ?? base.lockTimeout ?? SOLO_DEFAULTS.lockTimeout,
  };
}

/**
 * Validate configuration values are within acceptable ranges.
 *
 * @param config - Configuration to validate
 * @returns Array of validation errors (empty if valid)
 */
export function validateConfig(config: SoloConfig): string[] {
  const errors: string[] = [];

  if (
    config.confidenceThreshold !== undefined &&
    (config.confidenceThreshold < 0 || config.confidenceThreshold > 1)
  ) {
    errors.push(
      `confidenceThreshold must be between 0 and 1, got ${config.confidenceThreshold}`,
    );
  }

  if (
    config.coherenceThreshold !== undefined &&
    (config.coherenceThreshold < 0 || config.coherenceThreshold > 1)
  ) {
    errors.push(
      `coherenceThreshold must be between 0 and 1, got ${config.coherenceThreshold}`,
    );
  }

  if (
    config.riskThreshold !== undefined &&
    (config.riskThreshold < 0 || config.riskThreshold > 1)
  ) {
    errors.push(
      `riskThreshold must be between 0 and 1, got ${config.riskThreshold}`,
    );
  }

  if (config.lockTimeout !== undefined && config.lockTimeout <= 0) {
    errors.push(`lockTimeout must be positive, got ${config.lockTimeout}`);
  }

  return errors;
}

/**
 * Get the preset name that best matches given thresholds.
 *
 * @param config - Configuration to match
 * @returns Closest preset name
 */
export function getPresetFromConfig(config: SoloConfig): SoloPreset {
  const conf = config.confidenceThreshold ?? SOLO_DEFAULTS.confidenceThreshold;

  if (conf >= 0.95) return "conservative";
  if (conf >= 0.85) return "standard";
  return "aggressive";
}
