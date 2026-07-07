/**
 * @fileoverview Trusted Traveler Lanes
 * @description Fast-path scanning for trusted sources
 * @module weft-pro/trust
 * @since 1.0.0-beta.1
 *
 * 📝 BUILD[05.05]: Trusted traveler lanes implementation
 *
 * @remarks
 * Trusted traveler lanes provide fast-path scanning for trusted sources,
 * balancing security with performance. Full trust → skip scan entirely,
 * partial trust → quick scan only, no trust → full scan.
 *
 * Requires weft-core as peer dependency.
 */

// License gate — FATAL #6 HARDENING (2026-07-07)
import "./license-gate";

import type { TrustGrant, TrustLevel } from "./types";

/**
 * Registry for managing trusted sources.
 *
 * 📝 BUILD[05.05]: Pro feature - Trust-based fast lanes
 *
 * @example
 * ```typescript
 * import { TrustRegistry } from 'weft-pro';
 *
 * const registry = new TrustRegistry();
 *
 * // Register a trusted source
 * registry.register('agent-123', 'full', {
 *   expiresAt: Date.now() + 86400000, // 24 hours
 *   reason: 'Verified by security audit',
 * });
 *
 * // Check trust level
 * const grant = registry.check('agent-123');
 * if (grant && grant.level === 'full') {
 *   // Skip deep scanning
 * }
 * ```
 */
export class TrustRegistry {
  private grants: Map<string, TrustGrant> = new Map();

  /**
   * Register a trusted source.
   *
   * 📝 BUILD[05.05]: Trust registration
   */
  register(
    sourceId: string,
    level: TrustLevel,
    options?: {
      expiresAt?: number;
      reason?: string;
    },
  ): void {
    const grant: TrustGrant = {
      sourceId,
      level,
      grantedAt: Date.now(),
      expiresAt: options?.expiresAt,
      reason: options?.reason,
    };

    this.grants.set(sourceId, grant);
  }

  /**
   * Revoke trust for a source.
   *
   * 📝 BUILD[05.05]: Trust revocation
   */
  revoke(sourceId: string): boolean {
    return this.grants.delete(sourceId);
  }

  /**
   * Check trust level for a source.
   *
   * 📝 BUILD[05.05]: Trust checking
   */
  check(sourceId: string): TrustGrant | null {
    const grant = this.grants.get(sourceId);
    if (!grant) {
      return null;
    }

    // Check expiration
    if (grant.expiresAt && grant.expiresAt < Date.now()) {
      this.grants.delete(sourceId);
      return null;
    }

    return grant;
  }

  /**
   * Check if a trust grant is expired.
   *
   * 📝 BUILD[05.05]: Expiration check
   */
  isExpired(grant: TrustGrant): boolean {
    if (!grant.expiresAt) {
      return false;
    }
    return grant.expiresAt < Date.now();
  }

  /**
   * Get all trust grants.
   *
   * 📝 BUILD[05.05]: Grant enumeration
   */
  getAll(): Map<string, TrustGrant> {
    return new Map(this.grants);
  }

  /**
   * Clear all expired grants.
   *
   * 📝 BUILD[05.05]: Cleanup expired grants
   */
  cleanupExpired(): number {
    let cleaned = 0;
    for (const [sourceId, grant] of this.grants.entries()) {
      if (this.isExpired(grant)) {
        this.grants.delete(sourceId);
        cleaned++;
      }
    }
    return cleaned;
  }

  /**
   * Clear all grants.
   *
   * 📝 BUILD[05.05]: Registry reset
   */
  clear(): void {
    this.grants.clear();
  }
}

/**
 * Default global trust registry instance.
 *
 * 📝 BUILD[05.05]: Default registry for convenience
 */
export const defaultTrustRegistry = new TrustRegistry();

/**
 * Determine scan depth based on trust level.
 *
 * 📝 BUILD[05.05]: Trust-based scan routing
 */
export function getScanDepthForTrust(
  trustLevel: TrustLevel,
): "quick" | "standard" | "thorough" {
  switch (trustLevel) {
    case "full":
      return "quick"; // Skip deep scan
    case "partial":
      return "standard"; // Quick scan only
    default:
      return "thorough"; // Full scan
  }
}
