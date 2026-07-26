/**
 * Unified error types for weft-core.
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
  | "IDEMPOTENCY_VIOLATION"
  | "IDEMPOTENCY_STORE_WRITE_FAILED"
  | "COMPENSATION_FAILED"
  | "VALIDATION_ERROR"
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
 * Custom error class for weft-core with actionable feedback.
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
    return WeftError.sanitizeValue(context, seen) as Record<string, any>;
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
      return value.map((item) => WeftError.sanitizeValue(item, seen));
    }

    const sanitized: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      const lowerKey = key.toLowerCase();
      if (WeftError.SENSITIVE_KEYS.some((s) => lowerKey.includes(s))) {
        sanitized[key] = "[REDACTED]";
      } else {
        sanitized[key] = WeftError.sanitizeValue(val, seen);
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

/**
 * Thrown when a compensation (rollback) action itself fails after the primary
 * operation failed. Carries both the original error and the compensation error
 * so partially-restored external state is never silently concealed.
 *
 * @example
 * ```typescript
 * try { ... } catch (err) {
 *   if (err instanceof CompensationError) {
 *     console.error("Primary:", err.originalError.message);
 *     console.error("Rollback failed:", err.compensationError.message);
 *   }
 * }
 * ```
 */
export class CompensationError extends WeftError {
  /** The error thrown by the primary computation that triggered rollback. */
  readonly originalError: Error;
  /**
   * The first undo error — kept for backwards compatibility with `.compensate()` callers
   * that only have one compensation action. For multi-step sagas with multiple undo
   * failures, inspect {@link undoErrors} instead.
   */
  readonly compensationError: Error;
  /**
   * All undo errors collected during rollback, in LIFO execution order.
   * Each entry represents one resource that failed to roll back and may remain
   * in an uncompensated state.
   */
  readonly undoErrors: Error[];

  constructor(originalError: Error, undoErrors: Error | Error[]) {
    const errArr = Array.isArray(undoErrors) ? undoErrors : [undoErrors];
    const first = errArr[0]!;
    const undoSummary =
      errArr.length === 1
        ? `rollback error: "${first.message}"`
        : `${errArr.length} rollback errors: [${errArr.map((e) => `"${e.message}"`).join(", ")}]`;
    super({
      code: "COMPENSATION_FAILED",
      why: `Compensation failed: original error: "${originalError.message}"; ${undoSummary}. External state may be partially restored.`,
      action:
        "Inspect originalError and undoErrors on this instance. Manually verify external state consistency for each failed undo.",
      cause: originalError,
    });
    this.name = "CompensationError";
    this.originalError = originalError;
    this.compensationError = first;
    this.undoErrors = errArr;
  }
}

/**
 * Thrown when the idempotency store successfully persisted the computation
 * result but a later `set()` call failed. The computation DID execute and
 * succeed; the result is returned to the caller despite the store error, but
 * future calls with the same key will re-execute because the key was never
 * durably persisted.
 *
 * Callers MUST NOT retry on this error as if the computation failed — the
 * side effects already occurred.
 */
export class IdempotencyStoreWriteError extends WeftError {
  /** The computation result that was produced successfully. */
  readonly computationResult: unknown;

  constructor(key: string, storeError: unknown, computationResult: unknown) {
    const detail =
      storeError instanceof Error ? storeError.message : String(storeError);
    super({
      code: "IDEMPOTENCY_STORE_WRITE_FAILED",
      why: `Idempotency store write failed for key "${key}": ${detail}. The computation ran and succeeded; future calls with this key will re-execute.`,
      action:
        "Do NOT retry this error as a computation failure — the side effect already ran. Investigate the idempotency store health.",
      cause: storeError instanceof Error ? storeError : new Error(detail),
    });
    this.name = "IdempotencyStoreWriteError";
    this.computationResult = computationResult;
  }
}
