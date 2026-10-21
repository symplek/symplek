/**
 * @fileoverview Agent Antibodies
 * @description Pattern-based detection and blocking of known bad outputs
 * @module @symplek/pro/antibodies
 * @since 1.0.0-beta.1
 *
 * 📝 BUILD[05.05]: Agent antibodies implementation
 *
 * @remarks
 * Agent antibodies implement an adaptive immune system that learns from
 * failures and blocks known bad patterns before they cause problems.
 * Like biological antibodies, they detect, block, learn, and remember
 * patterns across executions.
 *
 * Requires @symplek/core as peer dependency.
 */

// License gate — FATAL #6 HARDENING (2026-07-07)
import "./license-gate";

import type {
  AntibodyScanResult,
  BadOutputPattern,
  PatternMatcher,
} from "./types";

/**
 * Registry for antibody patterns.
 *
 * 📝 BUILD[05.05]: Pro feature - Adaptive immune system
 *
 * @example
 * ```typescript
 * import { AntibodyRegistry } from '@symplek/pro';
 *
 * const registry = new AntibodyRegistry();
 *
 * // Register a known bad pattern
 * registry.registerPattern({
 *   id: 'injection-pattern-1',
 *   matcher: {
 *     type: 'regex',
 *     pattern: /<script[^>]*>/i,
 *   },
 *   description: 'Detects script injection attempts',
 *   severity: 'critical',
 *   learnedAt: Date.now(),
 * });
 *
 * // Scan output
 * const result = registry.scan('<script>alert("XSS")</script>');
 * if (result.recommendation === 'reject') {
 *   console.error('Blocked:', result.matches);
 * }
 * ```
 */
export class AntibodyRegistry {
  private readonly patterns: Map<string, BadOutputPattern> = new Map();

  /**
   * Register a known bad pattern.
   *
   * 📝 BUILD[05.05]: Pattern registration
   */
  registerPattern(pattern: BadOutputPattern): void {
    if (this.patterns.has(pattern.id)) {
      throw new Error(`Pattern with ID "${pattern.id}" already exists`);
    }
    this.patterns.set(pattern.id, pattern);
  }

  /**
   * Remove a pattern from the registry.
   *
   * 📝 BUILD[05.05]: Pattern removal
   */
  removePattern(patternId: string): boolean {
    return this.patterns.delete(patternId);
  }

  /**
   * Scan output against all registered patterns.
   *
   * 📝 BUILD[05.05]: Pattern scanning
   */
  scan(output: unknown): AntibodyScanResult {
    const matches: Array<{
      patternId: string;
      description: string;
      severity: string;
    }> = [];

    // Convert output to string for pattern matching
    const outputStr =
      typeof output === "string"
        ? output
        : typeof output === "object" && output !== null
          ? JSON.stringify(output)
          : String(output);

    // Check all patterns
    for (const pattern of this.patterns.values()) {
      if (this.matchesPattern(outputStr, pattern.matcher)) {
        matches.push({
          patternId: pattern.id,
          description: pattern.description,
          severity: pattern.severity,
        });
      }
    }

    // Determine recommendation
    const criticalMatches = matches.filter((m) => m.severity === "critical");
    const highMatches = matches.filter((m) => m.severity === "high");

    let recommendation: "reject" | "quarantine" | "allow" = "allow";
    if (criticalMatches.length > 0) {
      recommendation = "reject";
    } else if (highMatches.length > 0) {
      recommendation = "quarantine";
    } else if (matches.length > 0) {
      recommendation = "quarantine";
    }

    // Calculate confidence based on match count and severity
    const confidence = Math.min(
      1.0,
      matches.length * 0.3 + (criticalMatches.length > 0 ? 0.5 : 0),
    );

    return {
      recommendation,
      matches,
      confidence,
    };
  }

  /**
   * Check if output matches a pattern.
   *
   * 📝 BUILD[05.05]: Pattern matching logic
   */
  private matchesPattern(output: string, matcher: PatternMatcher): boolean {
    switch (matcher.type) {
      case "regex":
        // Fix[N56]: reset lastIndex before each call so a global/sticky regex
        // does not alternate match/no-match on identical input across invocations.
        matcher.pattern.lastIndex = 0;
        return matcher.pattern.test(output);
      case "function":
        return matcher.fn(output);
      case "substring":
        return output.includes(matcher.substring);
      case "schema":
        try {
          const parsed = JSON.parse(output);
          return this.matchesSchema(parsed, matcher.schema);
        } catch {
          return false;
        }
      default:
        return false;
    }
  }

  /**
   * Structural key-presence matcher. Returns `true` when the value
   * is an object whose top-level keys are a superset of the schema
   * object's top-level keys. Not a JSON Schema validator — this is
   * a lightweight shape check suitable for pattern-based detection.
   */
  private matchesSchema(value: unknown, schema: unknown): boolean {
    if (typeof schema !== "object" || schema === null) return false;
    if (typeof value !== "object" || value === null) return false;

    const requiredKeys = Object.keys(schema);
    if (requiredKeys.length === 0) return false;

    const valueKeys = new Set(Object.keys(value));
    return requiredKeys.every((key) => valueKeys.has(key));
  }

  /**
   * Get all registered patterns.
   *
   * 📝 BUILD[05.05]: Pattern enumeration
   */
  getAllPatterns(): BadOutputPattern[] {
    return Array.from(this.patterns.values());
  }

  /**
   * Clear all patterns.
   *
   * 📝 BUILD[05.05]: Registry reset
   */
  clear(): void {
    this.patterns.clear();
  }
}

/**
 * Default global antibody registry instance.
 *
 * 📝 BUILD[05.05]: Default registry for convenience
 */
export const defaultAntibodyRegistry = new AntibodyRegistry();
