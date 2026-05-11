/**
 * Unified error types for @weft/core.
 *
 * Two code systems coexist:
 *  - Exx codes (E001–E403) for developer-facing diagnostics with fix suggestions
 *  - Descriptive codes (AUTH_FAILED, TIMEOUT, …) for programmatic error handling
 *
 * ⚠️ FIX-GUARD[FP-WEFT-ERROR-CONSOLIDATION-20260313]: Consolidated from 5
 * incompatible WeftError definitions into this single canonical package-side
 * definition. The convex-side canonical definition lives in
 * convex/lib/agent_framework/core/weftErrors.ts (cannot share due to bundler).
 */

import { VERSION } from "./version";

// ── Exx Error Code Taxonomy ─────────────────────────────────────────────────

export type ErrorCode =
  // Type errors (E0XX)
  | "E000" // Unknown error (fallback)
  | "E001" // Type mismatch
  | "E002" // Missing required field
  | "E003" // Invalid property type
  | "E004" // Schema validation failed
  | "E005" // Unexpected null/undefined
  // Context errors (E1XX)
  | "E101" // Missing context
  | "E102" // Invalid context structure
  | "E103" // Context expired
  | "E104" // Context permission denied
  // Execution errors (E2XX)
  | "E201" // Execution timeout
  | "E202" // Low confidence
  | "E203" // Rate limit exceeded
  | "E204" // Tool execution failed
  | "E205" // Max steps exceeded
  // Coordination errors (E3XX)
  | "E301" // Consensus deadlock
  | "E302" // Challenge failed
  | "E303" // Circular dependency
  | "E304" // Low coherence
  // Security errors (E4XX)
  | "E401" // Injection detected
  | "E402" // Untrusted result
  | "E403"; // Spoofed result

// ── Descriptive Error Codes (backwards-compat) ─────────────────────────────

export type WeftErrorCode =
  | "AUTH_FAILED"
  | "RATE_LIMIT_EXCEEDED"
  | "INVALID_SCHEMA"
  | "PROVIDER_ERROR"
  | "SETUP_ERROR"
  | "TIMEOUT"
  | "NETWORK_ERROR"
  | "UNKNOWN_ERROR";

// ── WeftError Detail (attached to enhanced errors) ──────────────────────────

/**
 * Structured error detail attached to thrown errors via `enhanceError()`.
 * This is what consumers (e.g. AIErrorBoundary) read from `error.WeftError`.
 */
export interface WeftErrorDetail {
  code: ErrorCode;
  message: string;
  location?: {
    file?: string;
    line?: number;
    column?: number;
    operatorChain?: string[];
  };
  fix: {
    description: string;
    codeSnippet?: string;
    command?: string;
    docsUrl: string;
  };
  originalMessage: string;
  timestamp: number;
}

// ── WeftError Class ─────────────────────────────────────────────────────────

export interface WeftErrorOptions {
  code: WeftErrorCode;
  /** Human-readable error description (legacy field). Use `why` for new code. */
  message?: string;
  /** Human-readable explanation of what went wrong — preferred over `message` for new code. */
  why?: string;
  /** A runnable TypeScript example showing the correct setup or usage. */
  example?: string;
  action?: string;
  fix?: WeftErrorDetail["fix"];
  docs?: string;
  context?: Record<string, any>;
  cause?: unknown;
}

export interface SerializedError {
  name: string;
  code: WeftErrorCode;
  message: string;
  fix?: WeftErrorDetail["fix"];
  action?: string;
  docs?: string;
  example?: string;
  context?: Record<string, any>;
}

/**
 * Custom error class for @weft/core with actionable feedback.
 *
 * Error messages are automatically prefixed with `[weft@VERSION]` so they
 * are self-identifying in stack traces across bundled and server environments.
 *
 * @example
 * ```typescript
 * throw new WeftError({
 *   code: "PROVIDER_ERROR",
 *   why: "OPENAI_API_KEY is missing",
 *   fix: { description: "Set OPENAI_API_KEY", docsUrl: "https://platform.openai.com/api-keys" },
 *   example: 'process.env.OPENAI_API_KEY = "sk-..."',
 * });
 * ```
 */
export class WeftError extends Error {
  readonly code: WeftErrorCode;
  readonly action?: string;
  readonly fix?: WeftErrorDetail["fix"];
  readonly docs?: string;
  readonly example?: string;
  readonly context?: Record<string, any>;
  declare cause?: unknown;

  constructor(options: WeftErrorOptions) {
    const msg = options.why ?? options.message ?? "";
    super(`[weft@${VERSION}] ${msg}`);
    this.name = "WeftError";
    this.code = options.code;
    this.action = options.action;
    this.fix = options.fix;
    this.docs = options.docs;
    this.example = options.example;
    this.context = options.context
      ? WeftError.sanitizeContext(options.context)
      : undefined;

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, WeftError);
    }

    if (options.cause) {
      this.cause = options.cause;
    }
  }

  static sanitizeContext(context: Record<string, any>): Record<string, any> {
    const sensitiveKeys = [
      "api_key",
      "apikey",
      "secret",
      "token",
      "password",
      "auth",
      "credentials",
      "authorization",
    ];

    const sanitized: Record<string, any> = {};

    for (const [key, value] of Object.entries(context)) {
      const lowerKey = key.toLowerCase();
      if (sensitiveKeys.some((s) => lowerKey.includes(s))) {
        sanitized[key] = "[REDACTED]";
      } else if (value && typeof value === "object" && !Array.isArray(value)) {
        sanitized[key] = WeftError.sanitizeContext(value);
      } else {
        sanitized[key] = value;
      }
    }

    return sanitized;
  }

  toJSON(): SerializedError {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      fix: this.fix,
      action: this.action,
      docs: this.docs,
      example: this.example,
      context: this.context,
    };
  }
}
