/**
 * @fileoverview Public type definitions for @symplek/core
 * @description Core types exported from the MIT-licensed package
 * @module @symplek/core/types
 * @since 1.0.0-beta.1
 *
 * 📝 BUILD[05.04]: Public API types for @symplek/core package
 */

// ─────────────────────────────────────────────────────────────────────────────
// SOURCE TRACKING TYPES (Free Tier)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Source of a result in the agent pipeline.
 * Used to prevent memory poisoning by tracking where data came from.
 *
 * @remarks
 * Hallucinations from one agent can become "ground truth" for downstream agents.
 * Source tracking enables filtering low-confidence agent outputs and requiring
 * verification for critical decisions.
 */
export type ResultSource =
  | "user"
  | "agent"
  | "tool"
  | "verified"
  | "synthesized";

/**
 * A result with source tracking metadata.
 * Wraps any value T with provenance information.
 *
 * @remarks
 * TrackedResult enables confidence-based filtering and audit trails.
 * The private Symbol marker prevents memory poisoning via spoofed objects.
 */
export interface TrackedResult<T> {
  /** Allow private Symbol marker from trust module.
   *  ⚠️ Use isTrackedResult() to verify authenticity — the marker Symbol
   *  is not exported and the WeakSet registry is the true authority. */
  readonly [key: symbol]: unknown;

  /** The actual value */
  value: T;

  /** Source of this result */
  source: ResultSource;

  /** Confidence score (0-1). Lower = more likely hallucinated */
  confidence: number;

  /** When this result was verified (if source === 'verified') */
  verifiedAt?: number;

  /** Who/what verified this result */
  verifiedBy?: string;

  /** Chain of sources this result passed through */
  sourceChain?: ResultSource[];

  /** Lowest confidence in the chain (propagated) */
  minChainConfidence?: number;

  /**
   * Objective confidence assessment computed from observable behavior.
   * @remarks
   * When available, this provides mathematically computed confidence
   * based on agreement rate, entropy, variance, and behavioral signals.
   * This is more reliable than the `confidence` field which may be
   * subjectively reported by agents.
   * @since 1.0.0-beta.1
   */
  objectiveConfidence?: import("./confidence").ObjectiveConfidence;
}

/**
 * Private Symbol marker for TrackedResult authenticity.
 * Using Symbol() (not Symbol.for()) so it cannot be recreated from global registry.
 *
 * ⚠️ SECURITY: This prevents memory poisoning via spoofed TrackedResult objects.
 */
/**
 * Options for source tracking configuration.
 */
export interface SourceTrackingOptions {
  /** Initial source type */
  source: ResultSource;

  /** Initial confidence (0-1) */
  confidence: number;

  /** Optional verifier identifier */
  verifiedBy?: string;

  /** Whether to propagate confidence degradation through chain */
  propagateConfidence?: boolean;

  /** Confidence decay factor per hop (default: 0.95) */
  confidenceDecay?: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// CONSENSUS TYPES (Free Tier - Single-Round Only)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A vote in a consensus operation.
 *
 * @remarks
 * Note: agentId and weight are added by the consensus operator.
 * Voter functions should return votes without these fields.
 */
export interface Vote {
  /** Identifier of the voting agent (added by consensus operator) */
  agentId: string;
  /** The vote decision */
  decision: "approve" | "reject" | "abstain";
  /** Confidence in the decision (0-1) */
  confidence: number;
  /** Optional reasoning for the vote */
  reasoning?: string;
  /** Weight of this vote (added by consensus operator) */
  weight: number;
}

/**
 * A vote input from a voter function (without agentId and weight).
 * The consensus operator adds agentId and weight automatically.
 */
export interface VoteInput {
  /** The vote decision */
  decision: "approve" | "reject" | "abstain";
  /** Confidence in the decision (0-1) */
  confidence: number;
  /** Optional reasoning for the vote */
  reasoning?: string;
}

/**
 * Result of a consensus operation (single-round only).
 *
 * @remarks
 * This is the free-tier consensus result. For multi-round TaCo consensus,
 * see @symplek/pro package.
 */
export interface ConsensusResult {
  /** Whether consensus was reached (approved) */
  approved: boolean;
  /** All votes cast */
  votes: Vote[];
  /** Weighted approval percentage (0-1) */
  weightedApproval: number;
  /** The quorum threshold that was required */
  quorum: number;
  /** If vetoed, which agent vetoed */
  vetoedBy?: string;
  /** Consensus status */
  consensus: "reached" | "not-reached" | "vetoed";
  /**
   * Objective confidence assessment computed from voting behavior.
   * @remarks
   * This replaces subjective LLM confidence with mathematically computed
   * values based on agreement rate, entropy, variance, and behavioral signals.
   * @since 1.0.0-beta.1
   */
  objectiveConfidence?: import("./confidence").ObjectiveConfidence;
}

/**
 * Options for the `.consensus()` operator (single-round only).
 *
 * @remarks
 * For multi-round TaCo consensus options, see @symplek/pro package.
 */
export interface ConsensusOptions {
  /**
   * Quorum threshold (0-1).
   * @default 0.5 - Simple majority (50%)
   */
  quorum?: number;
  /** Vote weights by agent ID. Default: all 1.0 */
  weights?: Record<string, number>;
  /** Agent IDs with veto power */
  vetoers?: string[];
  /**
   * Per-vote timeout in milliseconds.
   *
   * @remarks
   * **AgentUnit voters** receive full cancellation: the abort signal is
   * propagated into the `AgentContext`, so LLM requests and nested
   * `AgentUnit.run()` calls are cancelled when the timeout fires.
   *
   * **Promise voters** only have the *awaiting* abandoned — the underlying
   * operation continues running and cannot receive a cancellation signal.
   * If the voter's work must be cancellable, return an `AgentUnit` instead
   * of a bare `Promise`.
   */
  timeout?: number;
  /** Require reasoning in votes */
  requireReasoning?: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// CONVERGE TYPES (Iterative Boolean Convergence)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Options for the `.converge()` operator.
 *
 * @remarks
 * Converge implements iterative refinement where multiple agents
 * contribute to a shared state until all agree they're done.
 */
export interface ConvergeOptions {
  /**
   * Maximum rounds before forced termination.
   * @default 5
   */
  maxRounds?: number;
  /**
   * Run agents in parallel each round.
   *
   * When true: all agents execute simultaneously per round and receive the
   * same `currentState` snapshot. Results are combined in agent-array order
   * according to `mergeStrategy`.
   *
   * When false: agents execute sequentially and each agent's result is
   * applied before the next agent runs.
   *
   * @default true
   */
  parallel?: boolean;
  /**
   * How to combine parallel agent contributions within a round.
   *
   * - `"last"` (default): the last agent's non-null result replaces current
   *   state. Deterministic by array position.
   * - `"reduce"`: contributions are applied left-to-right; each agent's
   *   non-null result replaces the running accumulator. All agents execute
   *   from the **original** round state, so this is not equivalent to serial
   *   mode.
   * - `"merge"`: shallow-merge for plain objects (properties from later agents
   *   overwrite earlier ones), last-wins for non-object types. Use when
   *   agents own independent, non-overlapping fields.
   *
   * When omitted, defaults to `"last"` (F-08 fix: the previous implicit
   * shallow-merge default could silently corrupt results when agents returned
   * overlapping plain-object keys; `"last"` is explicit and unambiguous).
   *
   * Only applies when `parallel` is true (or unset). Ignored in serial mode.
   */
  mergeStrategy?: "last" | "reduce" | "merge";
}

/**
 * A single agent's contribution in a converge round.
 *
 * @remarks
 * Each agent returns its modifications to the state and signals
 * whether it needs another round via `hasMore`.
 */
export interface ConvergeContribution<T> {
  /** The agent's result/modifications to the state */
  result: T;
  /** Does the agent want another round? */
  hasMore: boolean;
  /** Optional reasoning for the contribution */
  reasoning?: string;
}

/**
 * Result of a converge operation.
 *
 * @remarks
 * Contains the final converged state, round count, and per-agent
 * contribution tracking for audit trails.
 */
export interface ConvergeResult<T> {
  /** Final converged state */
  finalResult: T;
  /** Number of rounds executed */
  rounds: number;
  /** Did all agents return hasMore: false? */
  converged: boolean;
  /** Per-round contribution tracking */
  contributions: Array<{
    round: number;
    agentId: string;
    hadMore: boolean;
    reasoning?: string;
  }>;
}

/**
 * A convergent agent function type.
 * Takes current state and round number, returns contribution.
 *
 * @remarks
 * Can return an AgentUnit, Promise, or raw ConvergeContribution.
 * The converge operator handles all three cases.
 */
export type ConvergentAgent<T> = (
  current: T,
  round: number,
) =>
  | import("./AgentUnit").AgentUnit<ConvergeContribution<T>>
  | Promise<ConvergeContribution<T>>
  | ConvergeContribution<T>;

// ─────────────────────────────────────────────────────────────────────────────
// REFLECT TYPES
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A reflection agent function.
 *
 * @remarks
 * Takes an input and returns output as an AgentUnit, Promise, or raw value —
 * mirroring {@link ConvergentAgent}. These functions ARE the caller's
 * compute()/LLM calls; the reflect operator orchestrates them but never
 * constructs an LLM call of its own.
 */
export type ReflectAgent<I, O> = (
  input: I,
) => import("./AgentUnit").AgentUnit<O> | Promise<O> | O;

/**
 * Structured feedback returned by a reflect verifier agent.
 */
export interface ReflectVerifierFeedback {
  /** Concrete issues found in the output. An empty array means the verifier approves. */
  issues: string[];
  /** Verifier's confidence in the output's correctness, 0..1. */
  confidence?: number;
  /** Explicit approval flag; when omitted it is derived from `issues.length === 0`. */
  approved?: boolean;
}

/**
 * Options for the reflect operator.
 *
 * @typeParam T - The type of the output being reflected upon.
 */
export interface ReflectOptions<T = unknown> {
  /**
   * Generate a critique of the output.
   * @default true
   */
  critique?: boolean;
  /**
   * Chain an improvement pass when the verifier reports issues. Requires an
   * `improveAgent` to actually change the output.
   * @default false
   */
  improve?: boolean;
  /**
   * Maximum recursive reflection passes. Each pass reflects on the previous
   * improved output. @default 1 — hard-capped at {@link REFLECT_MAX_DEPTH} (10)
   * to prevent runaway self-review loops.
   */
  maxDepth?: number;
  /**
   * Produces critique text from the current output. When omitted (and `critique`
   * is enabled) a deterministic structural self-check is used instead — no LLM call.
   */
  critiqueAgent?: ReflectAgent<T, string>;
  /**
   * Turns critique text into structured feedback (issues + confidence). When
   * omitted, a built-in heuristic derives feedback from the critique text.
   */
  verifierAgent?: ReflectAgent<string, ReflectVerifierFeedback>;
  /**
   * Produces an improved output from the original plus its critique. Required
   * for `improve` to change anything; without it the original is preserved.
   */
  improveAgent?: ReflectAgent<{ original: T; critique: string }, T>;
}

/**
 * Result of a reflect operation.
 *
 * @typeParam T - The type of the output being reflected upon.
 */
export interface ReflectResult<T> {
  /** The original (pre-reflection) output. */
  original: T;
  /** Critique text, when `critique` is enabled. */
  critique?: string;
  /** Structured verifier feedback, when verification runs. */
  verifierFeedback?: ReflectVerifierFeedback;
  /** Improved output, when `improve` is enabled and issues were found. */
  improved?: T;
  /** Confidence in the final output, 0..1. */
  confidence: number;
  /** Number of reflection passes actually executed (1..maxDepth, capped at 10). */
  depth: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// RESILIENCE TYPES
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Options for retry operator.
 */
export interface RetryOptions {
  /** Maximum retry attempts (default: 3) */
  maxAttempts?: number;
  /** Base delay in ms (default: 100) */
  baseDelayMs?: number;
  /** Maximum delay in ms (default: 5000) */
  maxDelayMs?: number;
  /** Jitter factor (default: 0.1) */
  jitter?: number;
  /** Condition to retry */
  retryIf?: (error: Error, attempt: number) => boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// CONTEXT TYPES
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Minimal context for agent execution (standalone, no Convex dependency).
 *
 * @remarks
 * This is a simplified context that doesn't require Convex.
 * For full Convex integration, use @symplek/convex package.
 */
export interface AgentContext {
  /** Request timestamp */
  readonly timestamp: number;
  /** Abort signal for cancellation */
  readonly signal?: AbortSignal;
  /** Additional context data */
  readonly extensions?: Record<string, unknown>;
  /**
   * Idempotency key for this run, propagated to tool calls so side effects can
   * be deduplicated downstream. Set automatically by `AgentUnit.run()` when an
   * idempotency config is supplied; survives rehearsal replay via the context.
   */
  readonly idempotencyKey?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// TRUST MODE TYPES (Story 01.04/01.05: Zero-Trust Return Types)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Trust mode for agent execution.
 *
 * Controls how results are returned from `AgentUnit.run()`:
 * - `'zero-trust'`: Returns `TrackedResult<T>` with source tracking metadata (DEFAULT)
 * - `'legacy'`: Returns raw `T` (backward compatible, no tracking)
 *
 * @since 1.0.0-beta.1
 * @see {@link RunOptionsWithTrust} for usage in run options
 * @see {@link TrackedResult} for the zero-trust return type
 *
 * 📝 BUILD[01.04]: TrustMode type for zero-trust return types
 * 📝 BUILD[01.05]: Zero-trust is now the default
 *
 * @example
 * ```typescript
 * // Zero-trust mode (default, recommended)
 * const result = await agent.run(ctx);
 * // result is TrackedResult<T> with source and confidence
 *
 * // Legacy mode (backward compatible, deprecated)
 * const rawResult = await agent.run(ctx, { trustMode: 'legacy' });
 * // rawResult is raw T
 * ```
 */
export type TrustMode = "zero-trust" | "legacy";

/**
 * Extended run options with trust mode configuration.
 *
 * @since 1.0.0-beta.1
 * @see {@link TrustMode} for available modes
 *
 * 📝 BUILD[01.04]: RunOptionsWithTrust for type-safe trust mode selection
 * 📝 BUILD[01.05]: Default is now zero-trust
 *
 * @example
 * ```typescript
 * // Zero-trust mode (default) returns TrackedResult<T>
 * const tracked = await unit.run(ctx);
 * console.log(tracked.confidence); // 0.85 (base confidence; adjusts per operator chain)
 *
 * // Legacy mode returns raw T (deprecated)
 * const raw = await unit.run(ctx, { trustMode: 'legacy' });
 * ```
 */
export interface RunOptionsWithTrust {
  /**
   * Trust mode for result handling.
   *
   * @default 'zero-trust'
   * @deprecated `trustMode: 'legacy'` will be removed in v3.0.
   *   Migrate to zero-trust mode for source tracking and memory poisoning prevention.
   *
   * @remarks
   * - `'zero-trust'`: Results are wrapped in {@link TrackedResult} with source tracking
   * - `'legacy'`: Results are returned as raw values (no tracking metadata)
   *
   * Zero-trust mode is strongly recommended for production use as it enables:
   * - Memory poisoning prevention via source tracking
   * - Confidence-based filtering of agent outputs
   * - Audit trails for compliance requirements
   */
  trustMode?: TrustMode;

  /**
   * Whether to capture intermediate results during execution.
   * @default false
   */
  captureIntermediates?: boolean;

  /**
   * Optional idempotency configuration. When supplied, `AgentUnit.run()` checks
   * the store before executing: an existing key either throws
   * (`strategy: 'reject'`) or returns the cached result
   * (`strategy: 'return-cached'`). On a fresh key the result is stored after a
   * successful run and the key is propagated to tool calls via
   * {@link AgentContext.idempotencyKey}.
   */
  idempotency?: import("./idempotency").IdempotencyConfig;
}

// ─────────────────────────────────────────────────────────────────────────────
// CONTRACT TYPES (Story F-047)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Contract metadata attached to AgentUnit when .provides() or .expects() is used.
 *
 * @remarks
 * This metadata enables inspection of contract usage in agent compositions.
 * Access via `unit.getMetadata().contract`.
 *
 * @example
 * ```typescript
 * const unit = AgentUnit.of(data).provides(schema);
 * const meta = unit.getMetadata();
 * console.log(meta.contract?.type);       // 'output'
 * console.log(meta.contract?.schemaName); // schema description or 'anonymous'
 * ```
 *
 * 📝 BUILD[F-047]: Contract metadata for AgentUnit inspection
 */
export interface ContractMetadata {
  /**
   * Whether this is an input or output contract.
   * - 'input': Set by `.expects()` - validates input before computation
   * - 'output': Set by `.provides()` - validates output after computation
   */
  type: "input" | "output";

  /**
   * Name of the schema (from Zod's .describe() or 'anonymous').
   * Useful for debugging contract errors.
   */
  schemaName: string;

  /**
   * Whether strict mode is enabled (output contracts only).
   * In strict mode, extra fields not in schema cause validation to fail.
   */
  strict?: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// DEBATE TYPES (Story 01.01: F-048 Coordination Operators)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Options for the `.debate()` operator.
 *
 * @remarks
 * Debate combines converge (sequential refinement) with unanimous consensus.
 * Agents iterate until convergence, then take a unanimous vote.
 * If rejected, agents can retry with objections or fail immediately.
 *
 * 📝 BUILD[F-048]: Debate options for coordination operators
 */
export interface DebateOptions {
  /**
   * Maximum converge iterations per consensus attempt.
   * @default 10
   */
  maxRounds?: number;

  /**
   * Maximum unanimous consensus attempts before failing.
   * @default 3
   */
  maxConsensusAttempts?: number;

  /**
   * Behavior when unanimous vote fails.
   * - 'retry': Feed objections back and try again
   * - 'fail': Return immediately with no-consensus outcome
   * @default 'retry'
   */
  onReject?: "retry" | "fail";

  /**
   * Callback after each converge round.
   * @param round - Current round number (1-indexed)
   * @param state - Current state after this round
   * @param agentId - ID of the agent that contributed
   */
  onRoundComplete?: <T>(round: number, state: T, agentId: string) => void;

  /**
   * Callback after each consensus attempt.
   * @param attempt - Current attempt number (1-indexed)
   * @param votes - All votes from this attempt
   */
  onConsensusAttempt?: (attempt: number, votes: Vote[]) => void;
}

/**
 * Result of a debate operation.
 *
 * @typeParam T - The type of the debated state
 *
 * @remarks
 * Contains the final converged state, outcome status, and full audit trail
 * including all contributions and any objections from rejected consensus attempts.
 *
 * 📝 BUILD[F-048]: Debate result type with full audit trail
 */
export interface DebateResult<T> {
  /**
   * Outcome of the debate.
   * - 'consensus': All agents unanimously approved
   * - 'no-consensus': Vote rejected and onReject='fail'
   * - 'exhausted': Max consensus attempts reached without agreement
   */
  outcome: "consensus" | "no-consensus" | "exhausted";

  /**
   * Final converged state from the debate.
   */
  finalState: T;

  /**
   * Number of converge rounds executed in the final (or latest) attempt.
   */
  rounds: number;

  /**
   * Number of consensus attempts made.
   */
  attempts: number;

  /**
   * Whether all agents returned hasMore: false in the final converge.
   */
  converged: boolean;

  /**
   * Final votes from the last consensus attempt (if any).
   */
  votes?: Vote[];

  /**
   * Objections from agents who rejected consensus (if any).
   */
  objections?: Array<{ agentId: string; reasoning: string }>;

  /**
   * Per-round contribution tracking from all converge rounds.
   * Same structure as ConvergeResult.contributions.
   */
  contributions: ConvergeResult<T>["contributions"];

  /**
   * Objective confidence assessment computed from voting behavior.
   * @remarks
   * This replaces subjective LLM confidence with mathematically computed
   * values based on agreement rate, entropy, variance, and behavioral signals.
   * @since 1.0.0-beta.1
   */
  objectiveConfidence?: import("./confidence").ObjectiveConfidence;
}

/**
 * A debate agent is a convergent agent.
 * Takes current state and round number, returns contribution with hasMore flag.
 *
 * @typeParam T - The type of state being debated
 *
 * @remarks
 * Debate agents follow the same interface as convergent agents.
 * They participate in iterative refinement and signal completion via hasMore: false.
 *
 * 📝 BUILD[F-048]: Debate agent type alias for convergent agents
 */
export type DebateAgent<T> = ConvergentAgent<T>;

// ─────────────────────────────────────────────────────────────────────────────
// DIALECTIC TYPES (Story 01.02: F-048 Coordination Operators)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Options for the `.dialectic()` operator.
 *
 * @remarks
 * Dialectic implements the thesis/antithesis/synthesis pattern:
 * 1. Leader proposes thesis
 * 2. Advisors critique in parallel (antithesis)
 * 3. Leader synthesizes feedback (synthesis)
 * 4. Loop until termination condition met
 *
 * 📝 BUILD[F-048]: Dialectic options for leader-driven coordination
 */
export interface DialecticOptions {
  /**
   * Maximum thesis/antithesis/synthesis rounds.
   * @default 5
   */
  maxRounds?: number;

  /**
   * How to determine when dialectic is complete.
   * - 'leader-satisfied': Leader's satisfied flag ends the loop
   * - 'consensus': Unanimous advisor approval required
   * - 'majority': Majority (quorum) advisor approval required
   * @default 'leader-satisfied'
   */
  terminationMode?: "leader-satisfied" | "consensus" | "majority";

  /**
   * Quorum threshold for consensus/majority modes.
   * @default 1.0 for consensus, 0.5 for majority
   */
  quorum?: number;

  /**
   * Callback when leader proposes thesis.
   * @param round - Current round number
   * @param thesis - The proposed thesis
   */
  onThesis?: <T>(round: number, thesis: T) => void;

  /**
   * Callback when advisors submit critiques.
   * @param critiques - All advisor critiques
   */
  onAntitheses?: (critiques: Critique[]) => void;

  /**
   * Callback when leader synthesizes.
   * @param synthesisResponse - The synthesis response with synthesis and satisfied properties
   */
  onSynthesis?: <T>(synthesisResponse: SynthesisResponse<T>) => void;

  /**
   * How to handle advisor errors during critique phase.
   * - 'blocking': Error becomes a blocking critique (fail-closed, default)
   * - 'warning': Error becomes a minor critique (fail-open)
   * - 'skip': Silently drop the failed advisor's critique
   *
   * ⚠️ FIX-GUARD[FP-DIALECTIC-ADVISOR-ERROR-20260313]: Previously hardcoded
   * to blocking with no configuration option. Fail-closed is defensible but
   * surprising when a single transient advisor error blocks consensus.
   *
   * @default 'blocking'
   */
  onAdvisorError?: "blocking" | "warning" | "skip";
}

/**
 * A critique from an advisor in the dialectic process.
 *
 * @remarks
 * Advisors provide critiques with severity levels that can influence
 * termination in consensus/majority modes.
 *
 * 📝 BUILD[F-048]: Critique type for dialectic advisors
 */
export interface Critique {
  /**
   * Identifier of the advising agent.
   */
  advisorId: string;

  /**
   * The critique content.
   */
  critique: string;

  /**
   * Optional improvement suggestions.
   */
  suggestions?: string[];

  /**
   * Severity level of the critique.
   * - 'blocking': Must be addressed before approval
   * - 'major': Significant issue that should be addressed
   * - 'minor': Small issue, nice to fix
   * - 'nitpick': Stylistic preference, can be ignored
   */
  severity: "blocking" | "major" | "minor" | "nitpick";
}

/**
 * Result of a dialectic operation.
 *
 * @typeParam T - The type of the thesis being refined
 *
 * @remarks
 * Contains the final synthesized thesis, outcome status, and full history
 * of all thesis/antithesis/synthesis cycles.
 *
 * 📝 BUILD[F-048]: Dialectic result with full history tracking
 */
export interface DialecticResult<T> {
  /**
   * Outcome of the dialectic.
   * - 'satisfied': Leader signaled satisfaction
   * - 'consensus': All advisors approved
   * - 'majority': Majority of advisors approved
   * - 'max-rounds': Maximum rounds reached
   * - 'no-consensus': Voting failed in consensus/majority mode
   */
  outcome:
    | "satisfied"
    | "consensus"
    | "majority"
    | "max-rounds"
    | "no-consensus";

  /**
   * Final synthesized thesis.
   */
  finalThesis: T;

  /**
   * Number of rounds executed.
   */
  rounds: number;

  /**
   * Full history of all thesis/antithesis/synthesis cycles.
   */
  history: Array<{
    round: number;
    thesis: T;
    antitheses: Critique[];
    synthesis: T;
  }>;

  /**
   * Final votes if terminationMode required voting.
   */
  finalVotes?: Vote[];

  /**
   * Objective confidence assessment computed from voting behavior.
   * @remarks
   * This replaces subjective LLM confidence with mathematically computed
   * values based on agreement rate, entropy, variance, and behavioral signals.
   * Only populated when terminationMode uses voting (consensus/majority).
   * @since 1.0.0-beta.1
   */
  objectiveConfidence?: import("./confidence").ObjectiveConfidence;
}

/**
 * Leader agent interface for dialectic coordination.
 *
 * @typeParam T - The type of problem/thesis being refined
 *
 * @remarks
 * The leader drives the dialectic process by proposing theses
 * and synthesizing advisor feedback into improved solutions.
 *
 * 📝 BUILD[F-048]: Leader agent interface for dialectic
 */
export interface LeaderAgent<T> {
  /**
   * Propose initial or refined thesis.
   * @param problem - The problem or current state
   * @param round - Current round number (1-indexed)
   * @returns ThesisResponse with the proposed thesis
   */
  propose: (
    problem: T,
    round: number,
  ) => ThesisResponse<T> | Promise<ThesisResponse<T>>;

  /**
   * Synthesize advisor critiques into a new thesis.
   * @param thesis - The current thesis that was critiqued
   * @param critiques - All advisor critiques
   * @returns SynthesisResponse with the synthesized result
   */
  synthesize: (
    thesis: T,
    critiques: Critique[],
  ) => SynthesisResponse<T> | Promise<SynthesisResponse<T>>;
}

/**
 * Response from leader's propose method.
 *
 * @typeParam T - The type of thesis
 *
 * 📝 BUILD[F-048]: Thesis response type
 */
export interface ThesisResponse<T> {
  /**
   * The proposed thesis.
   */
  thesis: T;

  /**
   * Optional reasoning for this proposal.
   */
  reasoning?: string;
}

/**
 * Response from leader's synthesize method.
 *
 * @typeParam T - The type of synthesis result
 *
 * 📝 BUILD[F-048]: Synthesis response type
 */
export interface SynthesisResponse<T> {
  /**
   * The synthesized result incorporating feedback.
   */
  synthesis: T;

  /**
   * Leader's signal to stop (for leader-satisfied mode).
   * When true, dialectic terminates with 'satisfied' outcome.
   */
  satisfied: boolean;

  /**
   * Optional reasoning for this synthesis.
   */
  reasoning?: string;
}

/**
 * Advisor agent function type for dialectic coordination.
 *
 * @typeParam T - The type of thesis being reviewed
 *
 * @remarks
 * Advisors receive a thesis and return critiques.
 * They run in parallel during the antithesis phase.
 *
 * 📝 BUILD[F-048]: Advisor agent type for dialectic
 */
export type AdvisorAgent<T> = (
  thesis: T,
  round: number,
) => Critique | Promise<Critique>;

// ─────────────────────────────────────────────────────────────────────────────
// INTERVIEW TYPES (Symplek-interview-operator)
// 📝 BUILD[Symplek-interview]: Re-exports for interview types
// ─────────────────────────────────────────────────────────────────────────────

export type {
  Answer,
  Assumption,
  ClarityScore,
  EvaluatorAgent,
  ExtractorAgent,
  InterviewConfig,
  InterviewHandlers,
  InterviewOptions,
  InterviewPending,
  InterviewProgress,
  InterviewResult,
  InterviewState,
  Question,
  QuestionerAgent,
} from "./interview/types";

// ─────────────────────────────────────────────────────────────────────────────
// SOLO MECHANISM TYPES (Symplek-solo-mechanism)
// 📝 BUILD[STORY-02.05]: Re-exports for solo types
// ─────────────────────────────────────────────────────────────────────────────

export type {
  Checkpoint,
  ExtractedSignals,
  LockAcquisitionResult,
  LockEntry,
  LockManager,
  RollbackHandler,
  RollbackOptions,
  RollbackResult,
  SignalExtractionConfig,
  SoloConfig,
  SoloDecision,
  SoloPreset,
  SoloResult,
  TransactionEntry,
  TransactionLogManager,
  TransactionQuery,
  TransactionStatus,
} from "./solo/types";

export {
  LockAcquisitionError,
  RollbackError,
  SoloBlockedError,
} from "./solo/types";

// ─────────────────────────────────────────────────────────────────────────────
// COHERENCE OPERATOR TYPES
// 📝 BUILD[STORY-02.01]: Types for .coherence() operator
// ─────────────────────────────────────────────────────────────────────────────

import type {
  CoherencePreset,
  CoherenceWeights,
  EnsembleCoherence,
} from "./coherence/types";

/**
 * Options for the .coherence() operator.
 *
 * @remarks
 * Configure threshold checking and intervention callbacks for
 * coherence measurement on multi-agent results.
 *
 * @example Named preset
 * ```typescript
 * .coherence({ preset: 'critical' })
 * ```
 *
 * @example Custom threshold with callback
 * ```typescript
 * .coherence({
 *   threshold: 0.80,
 *   onDrop: (c) => alert(c.composite),
 * })
 * ```
 *
 * @example Fail on low coherence
 * ```typescript
 * .coherence({
 *   threshold: 0.90,
 *   failOnLowCoherence: true,
 * })
 * ```
 *
 * 📝 BUILD[STORY-02.01]: CoherenceOptions type
 */
export interface CoherenceOptions {
  /**
   * Minimum coherence threshold [0, 1].
   * Default: 0.70 (standard)
   */
  threshold?: number;

  /**
   * Named threshold preset (overrides threshold).
   * - 'critical': >= 0.95
   * - 'highStakes': >= 0.80
   * - 'standard': >= 0.70
   * - 'byzantine': >= 0.67
   */
  preset?: CoherencePreset;

  /**
   * Custom weights for composite calculation.
   * Partial - unspecified weights use defaults.
   */
  weights?: Partial<CoherenceWeights>;

  /**
   * Callback when coherence drops below threshold.
   * Called BEFORE returning result.
   */
  onDrop?: (coherence: EnsembleCoherence) => void | Promise<void>;

  /**
   * Throw error if coherence below threshold.
   * Default: false
   */
  failOnLowCoherence?: boolean;
}

/**
 * Result of the .coherence() operator.
 *
 * @remarks
 * Preserves the upstream multi-agent result while adding
 * coherence metrics and threshold evaluation.
 *
 * @example
 * ```typescript
 * const result = await AgentUnit.of(task)
 *   .consensus(voters)
 *   .coherence({ threshold: 0.80 })
 *   .run(ctx);
 *
 * result.value.result           // ConsensusResult (original)
 * result.value.coherence        // EnsembleCoherence
 * result.value.meetsThreshold   // boolean
 * result.value.threshold        // 0.80
 * ```
 *
 * 📝 BUILD[STORY-02.01]: CoherenceResult type
 */
export interface CoherenceResult<T> {
  /**
   * Original multi-agent result (ConsensusResult, DebateResult, etc.)
   */
  result: T;

  /**
   * Computed coherence metrics with full audit trail.
   */
  coherence: EnsembleCoherence;

  /**
   * Whether coherence.composite >= threshold.
   */
  meetsThreshold: boolean;

  /**
   * The threshold that was applied.
   */
  threshold: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// OBSERVABILITY TYPES (Free Tier — moved from @symplek/pro)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Verbosity level for observability trace recording.
 *
 * - `minimal`: Record only unit-level pass-through traces
 * - `detailed`: Record pass-through traces with result type metadata (default)
 * - `full`: Record all available metadata including result snapshots
 */
export type ObservabilityVerbosity = "minimal" | "detailed" | "full";

/**
 * A recorded trace entry from agent unit execution.
 * Collected by `observable()` wraps and `createOperatorSpan()` calls.
 */
export interface TraceEntry {
  spanId: string;
  operatorType: string;
  operatorName: string;
  startedAt: number;
  endedAt?: number;
  durationMs?: number;
  parentSpanId?: string;
  attributes: Record<string, unknown>;
}

/**
 * Receiver for trace entries. Register via `ObservabilityOptions.collector`
 * or `configureObservability({ collector })`.
 */
export interface TraceCollector {
  onSpanEnd: (entry: TraceEntry) => void;
}

/**
 * Handle returned by `createOperatorSpan()` for manual instrumentation.
 * Call `end()` when the operation completes to record timing.
 */
export interface Span {
  readonly spanId: string;
  setAttribute: (key: string, value: unknown) => void;
  end: (attributes?: Record<string, unknown>) => void;
}

/**
 * Options for configuring observability.
 */
export interface ObservabilityOptions {
  /** Verbosity level (default: "detailed") */
  verbosity?: ObservabilityVerbosity;

  /** Enable cost tracking in spans */
  trackCosts?: boolean;

  /** Enable error tracking in spans */
  trackErrors?: boolean;

  /** Optional collector that receives every completed span */
  collector?: TraceCollector;
}
