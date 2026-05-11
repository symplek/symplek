/**
 * @fileoverview Stigmergic Confidence with Decay
 * @description Indirect coordination with temporal confidence decay
 * @module weft-pro/stigmergy
 * @since 1.0.0-beta.1
 *
 * 📝 BUILD[05.05]: Stigmergic confidence with decay implementation
 *
 * @remarks
 * Stigmergy is indirect coordination through environmental signals (like ants
 * leaving pheromone trails). This extends basic stigmergy with confidence
 * scoring and temporal decay, enabling agents to coordinate without direct
 * communication while respecting information freshness.
 *
 * Requires weft-core as peer dependency.
 */

import type {
  ConfidenceDepositOptions,
  ConfidenceSenseOptions,
  ConfidentPheromone,
} from "./types";

/**
 * Creates a confident pheromone with temporal decay.
 *
 * 📝 BUILD[05.05]: Pro feature - Confidence-aware pheromone creation
 *
 * @example
 * ```typescript
 * import { createConfidentPheromone } from 'weft-pro';
 *
 * const pheromone = createConfidentPheromone('analysis-result', {
 *   confidence: 0.95,
 *   source: 'verified',
 *   evaporationRate: 0.01, // 1% per second
 * });
 *
 * // Check current confidence after time has passed
 * const current = pheromone.currentConfidence();
 * ```
 */
export function createConfidentPheromone<T>(
  value: T,
  options: ConfidenceDepositOptions,
): ConfidentPheromone<T> {
  const {
    confidence,
    source,
    evaporationRate = 0.01,
    minConfidence = 0.1,
  } = options;

  const depositedAt = Date.now();

  return {
    value,
    confidence,
    source,
    depositedAt,
    evaporationRate,
    currentConfidence() {
      const ageSeconds = (Date.now() - depositedAt) / 1000;
      // Formula: currentConfidence = initialConfidence * (1 - evaporationRate)^(age_in_seconds)
      return Math.max(0, confidence * (1 - evaporationRate) ** ageSeconds);
    },
    isExpired() {
      return this.currentConfidence() < minConfidence;
    },
  };
}

/**
 * Stigmergy layer with confidence-aware operations.
 *
 * 📝 BUILD[05.05]: Pro feature - Confidence-aware stigmergy layer
 *
 * @remarks
 * This is a simplified interface. Full implementation would integrate with
 * a distributed storage layer (e.g., Yjs/CRDT) for multi-agent coordination.
 */
export class ConfidentStigmergyLayer {
  private pheromones: Map<string, ConfidentPheromone<unknown>> = new Map();

  /**
   * Deposit a pheromone with confidence metadata.
   *
   * 📝 BUILD[05.05]: Confidence-aware deposit
   */
  deposit<T>(
    location: string,
    value: T,
    options: ConfidenceDepositOptions,
  ): void {
    const pheromone = createConfidentPheromone(value, options);
    this.pheromones.set(location, pheromone as ConfidentPheromone<unknown>);
  }

  /**
   * Sense a pheromone with confidence filtering.
   *
   * 📝 BUILD[05.05]: Confidence-based sensing
   */
  sense<T>(
    location: string,
    options?: ConfidenceSenseOptions,
  ): ConfidentPheromone<T> | undefined {
    const pheromone = this.pheromones.get(location) as
      | ConfidentPheromone<T>
      | undefined;

    if (!pheromone) {
      return undefined;
    }

    // Check expiration
    if (!options?.includeExpired && pheromone.isExpired()) {
      return undefined;
    }

    // Check minimum confidence
    if (
      options?.minConfidence !== undefined &&
      pheromone.currentConfidence() < options.minConfidence
    ) {
      return undefined;
    }

    return pheromone;
  }

  /**
   * Get all pheromones at a location (for aggregation).
   *
   * 📝 BUILD[05.05]: Multi-pheromone retrieval
   */
  senseAll<T>(
    location: string,
    options?: ConfidenceSenseOptions,
  ): ConfidentPheromone<T>[] {
    // Simplified - full implementation would support multiple deposits
    const pheromone = this.sense<T>(location, options);
    return pheromone ? [pheromone] : [];
  }

  /**
   * Clear expired pheromones.
   *
   * 📝 BUILD[05.05]: Cleanup expired entries
   */
  cleanup(): number {
    let cleaned = 0;
    for (const [location, pheromone] of this.pheromones.entries()) {
      if (pheromone.isExpired()) {
        this.pheromones.delete(location);
        cleaned++;
      }
    }
    return cleaned;
  }
}
