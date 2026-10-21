/**
 * @fileoverview Retry-Based Confidence Calculation
 * @description Tier 3 - Behavioral confidence from retry patterns
 * @module @symplek/core/confidence/calculations/retryConfidence
 * @since 2.0.0
 *
 * 📝 BUILD[01.07]: Retry confidence from behavioral research
 *
 * @remarks
 * Retry count is a behavioral signal indicating stability. More retries
 * suggest the operation was unstable or uncertain.
 *
 * Supports two decay models:
 * - Exponential: confidence = e^(-λ × retryCount)
 * - Linear: confidence = max(floor, 1 - retryCount / maxRetries)
 *
 * Properties:
 * - Range: [floor, 1] where floor is a configurable minimum
 * - Zero retries: 1.0 (perfect stability)
 * - Many retries: approaches floor
 */

import {
  DEFAULT_MAX_RETRIES,
  DEFAULT_RETRY_LAMBDA,
  RETRY_CONFIDENCE_FLOOR,
} from "../config";
import type { ConfidenceSignal } from "../types";

/**
 * Decay model for retry confidence calculation.
 */
export type RetryDecayModel = "exponential" | "linear";

/**
 * Options for retry confidence calculation.
 */
export interface RetryConfidenceOptions {
  /** Decay model to use */
  model?: RetryDecayModel;

  /** Lambda for exponential decay (higher = faster decay) */
  lambda?: number;

  /** Maximum retries for linear decay normalization */
  maxRetries?: number;

  /** Minimum confidence floor */
  floor?: number;
}

/**
 * Result of retry confidence calculation.
 */
export interface RetryConfidenceResult {
  /** Retry-based confidence [floor, 1] */
  retryConfidence: number;

  /** Number of retries analyzed */
  retryCount: number;

  /** Decay model used */
  model: RetryDecayModel;

  /** Detailed signal for audit trail */
  signal: ConfidenceSignal;
}

/**
 * Calculate retry-based confidence using exponential decay.
 *
 * @param retryCount - Number of retry attempts
 * @param lambda - Decay rate (higher = faster confidence drop)
 * @param floor - Minimum confidence value
 * @returns Confidence value [floor, 1]
 *
 * @remarks
 * Formula: confidence = max(floor, e^(-λ × retryCount))
 *
 * With λ = 0.5:
 * - 0 retries: 1.000
 * - 1 retry:   0.607
 * - 2 retries: 0.368
 * - 3 retries: 0.223
 * - 4 retries: 0.135
 * - 5 retries: 0.082
 */
function exponentialDecay(
  retryCount: number,
  lambda: number = DEFAULT_RETRY_LAMBDA,
  floor: number = RETRY_CONFIDENCE_FLOOR,
): number {
  const raw = Math.exp(-lambda * retryCount);
  return Math.max(floor, raw);
}

/**
 * Calculate retry-based confidence using linear decay.
 *
 * @param retryCount - Number of retry attempts
 * @param maxRetries - Maximum retries for normalization
 * @param floor - Minimum confidence value
 * @returns Confidence value [floor, 1]
 *
 * @remarks
 * Formula: confidence = max(floor, 1 - retryCount / maxRetries)
 *
 * With maxRetries = 5:
 * - 0 retries: 1.0
 * - 1 retry:   0.8
 * - 2 retries: 0.6
 * - 3 retries: 0.4
 * - 4 retries: 0.2
 * - 5 retries: floor
 */
function linearDecay(
  retryCount: number,
  maxRetries: number = DEFAULT_MAX_RETRIES,
  floor: number = RETRY_CONFIDENCE_FLOOR,
): number {
  const raw = 1 - retryCount / maxRetries;
  return Math.max(floor, raw);
}

/**
 * Calculate retry-based confidence.
 *
 * @param retryCount - Number of retry attempts
 * @param options - Calculation options
 * @param weight - Weight to assign to this signal
 * @returns Retry confidence result with full audit trail
 *
 * @example
 * ```typescript
 * // Default exponential decay
 * const result = calculateRetryConfidence(2);
 * console.log(result.retryConfidence); // ~0.37
 *
 * // Linear decay
 * const linear = calculateRetryConfidence(2, { model: 'linear' });
 * console.log(linear.retryConfidence); // 0.6
 *
 * // Custom lambda for slower decay
 * const slow = calculateRetryConfidence(2, { lambda: 0.25 });
 * console.log(slow.retryConfidence); // ~0.61
 * ```
 */
export function calculateRetryConfidence(
  retryCount: number,
  options: RetryConfidenceOptions = {},
  weight: number = 1.0,
): RetryConfidenceResult {
  const {
    model = "exponential",
    lambda = DEFAULT_RETRY_LAMBDA,
    maxRetries = DEFAULT_MAX_RETRIES,
    floor = RETRY_CONFIDENCE_FLOOR,
  } = options;

  // Handle negative retry counts
  const normalizedCount = Math.max(0, Math.floor(retryCount));

  // Calculate confidence based on model
  let retryConfidence: number;
  let formula: string;

  if (model === "exponential") {
    retryConfidence = exponentialDecay(normalizedCount, lambda, floor);
    const raw = Math.exp(-lambda * normalizedCount);
    formula =
      `retryConfidence = max(${floor}, e^(-${lambda} × ${normalizedCount})) ` +
      `= max(${floor}, ${raw.toFixed(4)}) = ${retryConfidence.toFixed(4)}`;
  } else {
    retryConfidence = linearDecay(normalizedCount, maxRetries, floor);
    const raw = 1 - normalizedCount / maxRetries;
    formula =
      `retryConfidence = max(${floor}, 1 - ${normalizedCount}/${maxRetries}) ` +
      `= max(${floor}, ${raw.toFixed(4)}) = ${retryConfidence.toFixed(4)}`;
  }

  return {
    retryConfidence,
    retryCount: normalizedCount,
    model,
    signal: {
      value: retryConfidence,
      tier: 3,
      weight,
      formula,
      inputs: {
        retryCount: normalizedCount,
        model,
        lambda: model === "exponential" ? lambda : undefined,
        maxRetries: model === "linear" ? maxRetries : undefined,
        floor,
      },
    },
  };
}

/**
 * Calculate verification depth confidence.
 *
 * @param verificationSteps - Number of verification steps completed
 * @param maxSteps - Maximum expected verification steps
 * @param weight - Weight for this signal
 * @returns Verification confidence result
 *
 * @remarks
 * Unlike retry confidence (more = worse), verification depth
 * confidence increases with more verification steps (more = better).
 *
 * Formula: confidence = min(1, verificationSteps / maxSteps)
 *
 * @example
 * ```typescript
 * const result = calculateVerificationDepthConfidence(2, 3);
 * console.log(result.signal.value); // 0.667
 * ```
 */
export function calculateVerificationDepthConfidence(
  verificationSteps: number,
  maxSteps: number = 3,
  weight: number = 1.0,
): { verificationConfidence: number; signal: ConfidenceSignal } {
  const normalizedSteps = Math.max(0, verificationSteps);
  const verificationConfidence = Math.min(1, normalizedSteps / maxSteps);

  return {
    verificationConfidence,
    signal: {
      value: verificationConfidence,
      tier: 3,
      weight,
      formula: `verificationConfidence = min(1, ${normalizedSteps}/${maxSteps}) = ${verificationConfidence.toFixed(4)}`,
      inputs: {
        verificationSteps: normalizedSteps,
        maxSteps,
      },
    },
  };
}

/**
 * Simple retry confidence without the full result object.
 *
 * @param retryCount - Number of retries
 * @param model - Decay model
 * @returns Confidence value
 */
export function simpleRetryConfidence(
  retryCount: number,
  model: RetryDecayModel = "exponential",
): number {
  return calculateRetryConfidence(retryCount, { model }).retryConfidence;
}
