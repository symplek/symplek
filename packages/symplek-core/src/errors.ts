/**
 * Unified error types for @symplek/core.
 *
 * Two code systems coexist:
 *  - Exx codes (E001–E403) for developer-facing diagnostics with fix suggestions
 *  - Descriptive codes (AUTH_FAILED, TIMEOUT, …) for programmatic error handling
 *
 * ⚠️ FIX-GUARD[FP-SYMPLEK-ERROR-CONSOLIDATION-20260313]: Consolidated from 5
 * incompatible SymplekError definitions into this single canonical package-side
 * definition. The convex-side canonical definition lives in
 * convex/lib/agent_framework/core/symplekErrors.ts (cannot share due to bundler).
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

export type SymplekErrorCode =
  | "AUTH_FAILED"
  | "RATE_LIMIT_EXCEEDED"
  | "INVALID_SCHEMA"
  | "PROVIDER_ERROR"
  | "SETUP_ERROR"
  | "TIMEOUT"
  | "NETWORK_ERROR"
  | "IDEMPOTENCY_VIOLATION"
  | "UNKNOWN_ERROR";

// ── SymplekError Detail (attached to enhanced errors) ──────────────────────────

/**
 * Structured error detail attached to thrown errors via `enhanceError()`.
 * This is what consumers (e.g. AIErrorBoundary) read from `error.SymplekError`.
 */
export interface SymplekErrorDetail {
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

// ── SymplekError Class ─────────────────────────────────────────────────────────

export interface SymplekErrorOptions {
  code: SymplekErrorCode;
  /** Human-readable error description (legacy field). Use `why` for new code. */
  message?: string;
  /** Human-readable explanation of what went wrong — preferred over `message` for new code. */
  why?: string;
  /** A runnable TypeScript example showing the correct setup or usage. */
  example?: string;
  action?: string;
  fix?: SymplekErrorDetail["fix"];
  docs?: string;
  context?: Record<string, any>;
  cause?: unknown;
}

export interface SerializedError {
  name: string;
  code: SymplekErrorCode;
  message: string;
  fix?: SymplekErrorDetail["fix"];
  action?: string;
  docs?: string;
  example?: string;
  context?: Record<string, any>;
}

/**
 * Custom error class for @symplek/core with actionable feedback.
 *
 * Error messages are automatically prefixed with `[symplek@VERSION]` so they
 * are self-identifying in stack traces across bundled and server environments.
 *
 * @example
 * ```typescript
 * throw new SymplekError({
 *   code: "PROVIDER_ERROR",
 *   why: "OPENAI_API_KEY is missing",
 *   fix: { description: "Set OPENAI_API_KEY", docsUrl: "https://platform.openai.com/api-keys" },
 *   example: 'process.env.OPENAI_API_KEY = "sk-..."',
 * });
 * ```
 */
export class SymplekError extends Error {
  readonly code: SymplekErrorCode;
  readonly action?: string;
  readonly fix?: SymplekErrorDetail["fix"];
  readonly docs?: string;
  readonly example?: string;
  readonly context?: Record<string, any>;
  declare cause?: unknown;

  constructor(options: SymplekErrorOptions) {
    const msg = options.why ?? options.message ?? "";
    super(`[symplek@${VERSION}] ${msg}`);
    this.name = "SymplekError";
    this.code = options.code;
    this.action = options.action;
    this.fix = options.fix;
    this.docs = options.docs;
    this.example = options.example;
    this.context = options.context
      ? SymplekError.sanitizeContext(options.context)
      : undefined;

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, SymplekError);
    }

    if (options.cause) {
      this.cause = options.cause;
    }
  }

  private static readonly SENSITIVE_KEYS = [
    "api_key",
    "apikey",
    "secret",
    "token",
    "password",
    "auth",
    "credentials",
    "authorization",
  ];

  /**
   * Deep-redact sensitive keys from an error context.
   *
   * Walks objects AND arrays recursively so secrets nested in an
   * array-of-objects (e.g. `{ headers: [{ authorization: "Bearer …" }] }`) are
   * caught — the previous implementation skipped arrays entirely. A `WeakSet`
   * seen-guard breaks reference cycles: a circular context (`a.self = a`) would
   * otherwise recurse until stack overflow, turning a logging path into a DoS.
   * On a cycle we substitute the literal `"[Circular]"`.
   *
   * @param seen - Internal accumulator of already-visited object references.
   *               Callers never pass this.
   */
  static sanitizeContext(
    context: Record<string, any>,
    seen: WeakSet<object> = new WeakSet(),
  ): Record<string, any> {
    return SymplekError.sanitizeValue(context, seen) as Record<string, any>;
  }

  private static sanitizeValue(value: unknown, seen: WeakSet<object>): unknown {
    if (value === null || typeof value !== "object") {
      return value;
    }

    // Cycle guard — a self-referential object must not recurse forever.
    if (seen.has(value as object)) {
      return "[Circular]";
    }
    seen.add(value as object);

    if (Array.isArray(value)) {
      return value.map((item) => SymplekError.sanitizeValue(item, seen));
    }

    const sanitized: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      const lowerKey = key.toLowerCase();
      if (SymplekError.SENSITIVE_KEYS.some((s) => lowerKey.includes(s))) {
        sanitized[key] = "[REDACTED]";
      } else {
        sanitized[key] = SymplekError.sanitizeValue(val, seen);
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
