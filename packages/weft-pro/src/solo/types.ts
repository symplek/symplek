/**
 * @fileoverview Solo Mechanism Types
 * @description Type definitions for autonomous agent action with safety guarantees
 * @module weft-core/solo/types
 * @since 2.2.0
 *
 * 📝 BUILD[STORY-01.01]: Solo types definition
 *
 * @remarks
 * The Solo mechanism enables agents to act autonomously when confidence
 * and coherence are high, with distributed locking and rollback capabilities.
 *
 * Mathematical decision formula:
 * ```
 * shouldActSolo = confidence >= 0.90
 *               && coherence >= 0.85
 *               && lockAcquired
 *               && riskScore <= 0.30
 * ```
 */

// ─────────────────────────────────────────────────────────────────────────────
// SOLO DECISION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Result of solo decision evaluation.
 * Captures whether an agent can act autonomously and why.
 */
export interface SoloDecision {
  /** Whether the agent can proceed autonomously */
  canActSolo: boolean;

  /** Confidence score (0-1) from agent computation */
  confidence: number;

  /** Coherence score (0-1) from ensemble alignment */
  coherence: number;

  /** Risk score (0-1) estimated from action type */
  riskScore: number;

  /** Whether the distributed lock was acquired */
  lockAcquired: boolean;

  /** Human-readable reason if canActSolo is false */
  reason?: string;

  /** Timestamp when decision was made */
  timestamp?: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// SOLO CONFIGURATION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Configuration for solo execution.
 * All thresholds are optional with sensible defaults.
 */
export interface SoloConfig {
  /**
   * Minimum confidence required for solo action.
   * @default 0.90
   */
  confidenceThreshold?: number;

  /**
   * Minimum coherence required for solo action.
   * @default 0.85
   */
  coherenceThreshold?: number;

  /**
   * Maximum risk score allowed for solo action.
   * @default 0.30
   */
  riskThreshold?: number;

  /**
   * Lock timeout in milliseconds.
   * @default 30000 (30 seconds)
   */
  lockTimeout?: number;

  /**
   * Resource identifier for locking.
   * If not provided, uses context.resourceId or 'default'.
   */
  resourceId?: string;

  /**
   * Callback invoked when solo action is permitted.
   */
  onSoloAction?: (decision: SoloDecision) => void | Promise<void>;

  /**
   * Callback invoked when solo action is blocked.
   */
  onBlocked?: (decision: SoloDecision) => void | Promise<void>;

  /**
   * Callback invoked before lock acquisition.
   */
  onLockAttempt?: (resourceId: string) => void | Promise<void>;

  /**
   * Callback invoked after lock release.
   */
  onLockRelease?: (resourceId: string, held: boolean) => void | Promise<void>;
}

/**
 * Preset configurations for common solo scenarios.
 */
export type SoloPreset =
  | "conservative" // High thresholds (default)
  | "standard" // Balanced thresholds
  | "aggressive"; // Lower thresholds (use with caution)

// ─────────────────────────────────────────────────────────────────────────────
// SOLO RESULT
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Result of a solo execution.
 * Wraps the original value with solo metadata.
 *
 * @template T - The type of the wrapped value
 */
export interface SoloResult<T> {
  /** The computed value */
  value: T;

  /** The decision that allowed solo execution */
  decision: SoloDecision;

  /** Unique transaction identifier for audit trail */
  transactionId: string;

  /** Timestamp of solo execution */
  timestamp: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// DISTRIBUTED LOCK TYPES (Story 01.04)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Lock entry in the distributed lock store.
 */
export interface LockEntry {
  /** Unique identifier of the lock holder */
  agentId: string;

  /** Unix timestamp when lock expires */
  expires: number;

  /** Resource being locked */
  resourceId: string;

  /** When the lock was acquired */
  acquiredAt: number;
}

/**
 * Lock acquisition result.
 */
export interface LockAcquisitionResult {
  /** Whether the lock was acquired */
  acquired: boolean;

  /** If acquired, the lock entry */
  lock?: LockEntry;

  /** If not acquired, reason why */
  reason?: "already_held" | "expired" | "contention";

  /** If not acquired, who holds the lock */
  heldBy?: string;
}

/**
 * Lock manager interface for extensibility.
 * Default implementation is in-memory; can be swapped for Redis/Convex.
 */
export interface LockManager {
  /** Attempt to acquire a lock */
  acquire(
    resourceId: string,
    agentId: string,
    timeoutMs: number,
  ): Promise<LockAcquisitionResult>;

  /** Release a held lock */
  release(resourceId: string, agentId: string): Promise<boolean>;

  /** Check if a resource is locked */
  isLocked(resourceId: string): Promise<boolean>;

  /** Get current lock holder (if any) */
  getHolder(resourceId: string): Promise<string | undefined>;

  /** Extend an existing lock's TTL */
  extend(
    resourceId: string,
    agentId: string,
    additionalMs: number,
  ): Promise<boolean>;
}

// ─────────────────────────────────────────────────────────────────────────────
// TRANSACTION LOG TYPES (Story 01.06)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Status of a transaction.
 */
export type TransactionStatus = "pending" | "committed" | "rolledBack";

/**
 * Single entry in the transaction log.
 * Provides audit trail and enables rollback.
 */
export interface TransactionEntry {
  /** Unique transaction identifier */
  id: string;

  /** Agent that initiated the transaction */
  agentId: string;

  /** Action being performed */
  action: string;

  /** Input data for the action */
  input: unknown;

  /** Output data (set on commit) */
  output?: unknown;

  /** When the transaction was created */
  timestamp: number;

  /** Current status */
  status: TransactionStatus;

  /** Checkpoint ID for rollback (optional) */
  checkpointId?: string;

  /** Error message if rolledBack */
  error?: string;

  /** Duration in milliseconds (set on completion) */
  durationMs?: number;
}

/**
 * Query options for transaction log.
 */
export interface TransactionQuery {
  /** Filter by agent */
  agentId?: string;

  /** Filter by status */
  status?: TransactionStatus;

  /** Filter by action name */
  action?: string;

  /** Filter by time range (start) */
  since?: number;

  /** Filter by time range (end) */
  until?: number;

  /** Maximum results to return */
  limit?: number;
}

/**
 * Transaction log manager interface.
 */
export interface TransactionLogManager {
  /** Create a new pending transaction */
  create(agentId: string, action: string, input: unknown): TransactionEntry;

  /** Mark transaction as committed */
  commit(id: string, output: unknown): void;

  /** Mark transaction as rolled back */
  rollback(id: string, error?: string): void;

  /** Get a transaction by ID */
  get(id: string): TransactionEntry | undefined;

  /** Query transactions */
  query(options: TransactionQuery): TransactionEntry[];

  /** Get all pending transactions */
  getPending(): TransactionEntry[];

  /** Clear completed transactions older than cutoff */
  prune(olderThanMs: number): number;
}

// ─────────────────────────────────────────────────────────────────────────────
// ROLLBACK TYPES (Story 01.08)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Checkpoint for state restoration.
 *
 * @template S - Type of the checkpointed state
 */
export interface Checkpoint<S> {
  /** Unique checkpoint identifier */
  id: string;

  /** Checkpointed state */
  state: S;

  /** When checkpoint was created */
  timestamp: number;

  /** Associated transaction ID (optional) */
  transactionId?: string;
}

/**
 * Handler for checkpoint creation and restoration.
 *
 * @template S - Type of the checkpointed state
 */
export interface RollbackHandler<S> {
  /** Create a checkpoint of current state */
  checkpoint(): S;

  /** Restore state from checkpoint */
  restore(state: S): void | Promise<void>;

  /** Optional: validate restored state */
  validate?(state: S): boolean;
}

/**
 * Options for rollback execution.
 */
export interface RollbackOptions {
  /** Whether to validate state after restore */
  validateAfterRestore?: boolean;

  /** Maximum rollback retries on failure */
  maxRetries?: number;

  /** Callback on successful rollback */
  onRollback?: (checkpointId: string) => void | Promise<void>;

  /** Callback on rollback failure */
  onRollbackError?: (error: Error) => void | Promise<void>;
}

/**
 * Result of a rollback operation.
 */
export interface RollbackResult {
  /** Whether rollback succeeded */
  success: boolean;

  /** Checkpoint that was restored */
  checkpointId: string;

  /** Error if rollback failed */
  error?: Error;

  /** How long rollback took */
  durationMs: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// SIGNAL EXTRACTION TYPES (Story 02.03)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Extracted signals from a value for solo decision.
 */
export interface ExtractedSignals {
  /** Confidence signal (0-1) */
  confidence: number;

  /** Coherence signal (0-1) */
  coherence: number;

  /** Risk score (0-1) */
  riskScore: number;

  /** Source of signals */
  source: "explicit" | "inferred" | "default";
}

/**
 * Configuration for signal extraction.
 */
export interface SignalExtractionConfig {
  /** Default confidence if not extractable */
  defaultConfidence?: number;

  /** Default coherence if not extractable */
  defaultCoherence?: number;

  /** Default risk score if not extractable */
  defaultRiskScore?: number;

  /** Custom extractor function */
  customExtractor?: (value: unknown) => Partial<ExtractedSignals>;
}

// ─────────────────────────────────────────────────────────────────────────────
// ERROR TYPES (Story 02.04)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Error thrown when solo action is blocked.
 */
export class SoloBlockedError extends Error {
  /** Error code for programmatic handling */
  readonly code = "E501";

  /** The decision that blocked the action */
  readonly decision: SoloDecision;

  constructor(decision: SoloDecision) {
    const reason = decision.reason ?? "Solo action blocked";
    super(`[E501] Solo Blocked: ${reason}`);
    this.name = "SoloBlockedError";
    this.decision = decision;

    // Maintain proper stack trace
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, SoloBlockedError);
    }
  }
}

/**
 * Error thrown when lock acquisition fails.
 */
export class LockAcquisitionError extends Error {
  /** Error code for programmatic handling */
  readonly code = "E502";

  /** Resource that could not be locked */
  readonly resourceId: string;

  /** Who currently holds the lock */
  readonly heldBy?: string;

  constructor(resourceId: string, heldBy?: string) {
    const message = heldBy
      ? `[E502] Lock Acquisition Failed: Resource "${resourceId}" is held by "${heldBy}"`
      : `[E502] Lock Acquisition Failed: Resource "${resourceId}" is locked`;
    super(message);
    this.name = "LockAcquisitionError";
    this.resourceId = resourceId;
    this.heldBy = heldBy;

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, LockAcquisitionError);
    }
  }
}

/**
 * Error thrown when rollback fails.
 */
export class RollbackError extends Error {
  /** Error code for programmatic handling */
  readonly code = "E503";

  /** Transaction that failed to rollback */
  readonly transactionId: string;

  /** Original error that triggered rollback */
  readonly cause?: Error;

  constructor(transactionId: string, cause?: Error) {
    super(
      `[E503] Rollback Failed: Transaction "${transactionId}" could not be rolled back`,
    );
    this.name = "RollbackError";
    this.transactionId = transactionId;
    this.cause = cause;

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, RollbackError);
    }
  }
}
