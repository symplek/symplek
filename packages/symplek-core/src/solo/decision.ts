/**
 * @fileoverview Solo Decision Algorithm
 * @description Core decision logic for autonomous agent action
 * @module @symplek/core/solo/decision
 * @since 2.2.0
 *
 * 📝 BUILD[STORY-01.02]: Decision algorithm implementation
 *
 * @remarks
 * Implements the mathematical decision formula:
 * ```
 * shouldActSolo = confidence >= 0.90
 *               && coherence >= 0.85
 *               && lockAcquired
 *               && riskScore <= 0.30
 * ```
 *
 * Based on research:
 * - PRISM framework: Confidence thresholds reduce error rates
 * - RAC algorithm: Coherence ensures group alignment
 * - Risk scoring: Conservative approach for autonomous actions
 */

import { SOLO_DEFAULTS } from "./config";
import type { SoloConfig, SoloDecision } from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// DECISION ALGORITHM
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Determine whether an agent should act autonomously.
 *
 * @param confidence - Agent's confidence in the action (0-1)
 * @param coherence - Ensemble coherence score (0-1)
 * @param riskScore - Estimated risk of the action (0-1)
 * @param lockAcquired - Whether the distributed lock was acquired
 * @param config - Optional configuration overrides
 * @returns Decision result with reasoning
 *
 * @example
 * ```typescript
 * const decision = shouldActSolo(0.92, 0.88, 0.15, true);
 * if (decision.canActSolo) {
 *   // Proceed with autonomous action
 * } else {
 *   console.log("Blocked:", decision.reason);
 * }
 * ```
 */
export function shouldActSolo(
  confidence: number,
  coherence: number,
  riskScore: number,
  lockAcquired: boolean,
  config: SoloConfig = {},
): SoloDecision {
  const {
    confidenceThreshold = SOLO_DEFAULTS.confidenceThreshold,
    coherenceThreshold = SOLO_DEFAULTS.coherenceThreshold,
    riskThreshold = SOLO_DEFAULTS.riskThreshold,
  } = config;

  // Apply the decision formula
  const canActSolo =
    confidence >= confidenceThreshold &&
    coherence >= coherenceThreshold &&
    lockAcquired &&
    riskScore <= riskThreshold;

  // Generate reason if blocked (check in priority order)
  let reason: string | undefined;
  if (!canActSolo) {
    if (!lockAcquired) {
      reason =
        "Lock not acquired - another process may be operating on this resource";
    } else if (confidence < confidenceThreshold) {
      reason = `Confidence ${formatPercent(confidence)} below threshold ${formatPercent(confidenceThreshold)}`;
    } else if (coherence < coherenceThreshold) {
      reason = `Coherence ${formatPercent(coherence)} below threshold ${formatPercent(coherenceThreshold)}`;
    } else if (riskScore > riskThreshold) {
      reason = `Risk score ${formatPercent(riskScore)} exceeds threshold ${formatPercent(riskThreshold)}`;
    }
  }

  return {
    canActSolo,
    confidence,
    coherence,
    riskScore,
    lockAcquired,
    reason,
    timestamp: Date.now(),
  };
}

/**
 * Create a decision from pre-computed signals.
 * Convenience function for use with signal extraction.
 *
 * @param signals - Pre-extracted signals
 * @param lockAcquired - Whether lock was acquired
 * @param config - Optional configuration
 * @returns Decision result
 */
export function decisionFromSignals(
  signals: { confidence: number; coherence: number; riskScore: number },
  lockAcquired: boolean,
  config: SoloConfig = {},
): SoloDecision {
  return shouldActSolo(
    signals.confidence,
    signals.coherence,
    signals.riskScore,
    lockAcquired,
    config,
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// DECISION HELPERS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Check if a decision passed all thresholds (ignoring lock status).
 * Useful for pre-flight checks before lock acquisition.
 *
 * @param confidence - Confidence score
 * @param coherence - Coherence score
 * @param riskScore - Risk score
 * @param config - Optional configuration
 * @returns True if thresholds are met
 */
export function meetsThresholds(
  confidence: number,
  coherence: number,
  riskScore: number,
  config: SoloConfig = {},
): boolean {
  const {
    confidenceThreshold = SOLO_DEFAULTS.confidenceThreshold,
    coherenceThreshold = SOLO_DEFAULTS.coherenceThreshold,
    riskThreshold = SOLO_DEFAULTS.riskThreshold,
  } = config;

  return (
    confidence >= confidenceThreshold &&
    coherence >= coherenceThreshold &&
    riskScore <= riskThreshold
  );
}

/**
 * Calculate how far signals are from thresholds.
 * Positive = exceeds threshold (good), negative = below threshold (bad).
 *
 * @param decision - The decision to analyze
 * @param config - Configuration with thresholds
 * @returns Margin for each signal
 */
export function calculateMargins(
  decision: SoloDecision,
  config: SoloConfig = {},
): {
  confidenceMargin: number;
  coherenceMargin: number;
  riskMargin: number;
} {
  const {
    confidenceThreshold = SOLO_DEFAULTS.confidenceThreshold,
    coherenceThreshold = SOLO_DEFAULTS.coherenceThreshold,
    riskThreshold = SOLO_DEFAULTS.riskThreshold,
  } = config;

  return {
    // Positive margin = confidence exceeds threshold (good)
    confidenceMargin: decision.confidence - confidenceThreshold,
    // Positive margin = coherence exceeds threshold (good)
    coherenceMargin: decision.coherence - coherenceThreshold,
    // Positive margin = risk below threshold (good) - note the inversion
    riskMargin: riskThreshold - decision.riskScore,
  };
}

/**
 * Get a human-readable summary of the decision.
 *
 * @param decision - The decision to summarize
 * @returns Human-readable summary
 */
export function formatDecision(decision: SoloDecision): string {
  const status = decision.canActSolo ? "✅ APPROVED" : "❌ BLOCKED";
  const parts = [
    status,
    `Confidence: ${formatPercent(decision.confidence)}`,
    `Coherence: ${formatPercent(decision.coherence)}`,
    `Risk: ${formatPercent(decision.riskScore)}`,
    `Lock: ${decision.lockAcquired ? "Acquired" : "Not acquired"}`,
  ];

  if (decision.reason) {
    parts.push(`Reason: ${decision.reason}`);
  }

  return parts.join(" | ");
}

// ─────────────────────────────────────────────────────────────────────────────
// PRIVATE HELPERS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Format a decimal as a percentage string.
 */
function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}
