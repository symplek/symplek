export type RiskTier = "P0" | "P1" | "P2";
export type AuthorType = "agent" | "user";

export interface Precondition {
  type: string;
  descriptor: string;
}

export interface Postcondition {
  type: string;
  descriptor: string;
}

export interface ConsultationEntry {
  specialist: string;
  confidence: number;
  reasoning: string;
  domain: string;
  consultedAt: number;
  latencyMs: number;
  vetoExercised: boolean;
}

export type ImpactTier = "low" | "medium" | "high";

export interface ConsultationTrace {
  entries: ConsultationEntry[];
  impactTier: ImpactTier;
  totalLatencyMs: number;
  timedOut: boolean;
  consensusReached: boolean;
}

export interface PatchOp<TPayload = Record<string, unknown> | undefined> {
  opId: string;
  kind: string;
  targetId: string;
  payload?: TPayload;
  preconditions?: Precondition[];
  postconditions?: Postcondition[];
}

export interface PatchSet<O extends PatchOp = PatchOp> {
  patchSetId: string;
  baseRef: string;
  authorType: AuthorType;
  consultationTrace: ConsultationEntry[];
  riskTier: RiskTier;
  ops: O[];
  confidence: number;
  createdAt: number;
}

export interface ValidationError {
  path: string;
  message: string;
}

export type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; errors: ValidationError[] };

export interface Conflict<O extends PatchOp = PatchOp> {
  conflictId: string;
  targetId: string;
  kind: string;
  ops: [O, O];
}

export interface MergeResult<O extends PatchOp = PatchOp> {
  merged: PatchSet<O>;
  conflicts: Conflict<O>[];
  autoMerged: boolean;
}

export type ConflictClass = "structural" | "temporal" | "resource" | "policy";
export type ConflictResolution = "auto" | "escalate" | "block";

export interface ConflictResolutionOption<O extends PatchOp = PatchOp> {
  rank: number;
  label: string;
  description: string;
  patchOps: O[];
}

export interface ClassificationContext {
  hints?: Record<string, unknown>;
}

export interface ClassifiedConflict<O extends PatchOp = PatchOp>
  extends Conflict<O> {
  class: ConflictClass;
  resolution: ConflictResolution;
}

export type ConflictClassifier<O extends PatchOp = PatchOp> = (
  conflict: Conflict<O>,
  context?: ClassificationContext,
) => ClassifiedConflict<O> | null;

export interface EscalationRequest<O extends PatchOp = PatchOp> {
  conflict: ClassifiedConflict<O>;
  options: ConflictResolutionOption<O>[];
}

export interface EscalationResponse<O extends PatchOp = PatchOp> {
  status: "resolved" | "deferred" | "blocked";
  chosenOption?: ConflictResolutionOption<O>;
  actor: { type: "user" | "agent" | "system"; id: string };
  reason: string;
  timestamp: number;
}

export type EscalationHandler<O extends PatchOp = PatchOp> = (
  request: EscalationRequest<O>,
) => EscalationResponse<O>;

export type EscalationHandlerMap<O extends PatchOp = PatchOp> = Partial<
  Record<ConflictClass, EscalationHandler<O>>
>;

export interface EscalationResult<O extends PatchOp = PatchOp> {
  resolved: Array<{
    conflict: ClassifiedConflict<O>;
    response: EscalationResponse<O>;
  }>;
  deferred: Array<{
    conflict: ClassifiedConflict<O>;
    response: EscalationResponse<O>;
  }>;
  blocked: Array<{
    conflict: ClassifiedConflict<O>;
    response: EscalationResponse<O>;
  }>;
}

export interface SpecialistDescriptor {
  id: string;
  domain: string;
  capabilities: string[];
  vetoCapable: boolean;
}

export interface ConsultationBudget {
  maxSpecialists: number;
  maxLatencyMs: number;
  requiredSpecialists: string[];
  consensusRequired: boolean;
  includeChallenge: boolean;
}

export interface ConsultationPlan {
  specialists: SpecialistDescriptor[];
  budget: ConsultationBudget;
  earlyStop: {
    maxLatencyMs: number;
    timedOut: boolean;
    consulted: string[];
  };
}

export interface DecisionPacket<O extends PatchOp = PatchOp> {
  decisionId: string;
  recommendations: Recommendation<O>[];
  consultationTrace: ConsultationTrace;
  riskTier: RiskTier;
  synthesisMethod: "broadcast" | "dialectic" | "debate" | "converge";
  confidence: number;
}

export interface Recommendation<O extends PatchOp = PatchOp> {
  action: string;
  targetIds: string[];
  suggestedOps: O[];
  priority: number;
}

export interface ConversionError {
  path: string;
  message: string;
}

export type ConversionResult<O extends PatchOp = PatchOp> =
  | { ok: true; patchSet: PatchSet<O> }
  | { ok: false; errors: ConversionError[] };

export interface ApprovalPolicy {
  tier: RiskTier;
  requiresExplicitApproval: boolean;
  allowsAutoApproval: boolean;
  undoWindowMs: number;
  escalationRequired: boolean;
  bundlingAllowed: boolean;
}

export type ApprovalAction =
  | "require_approval"
  | "auto_approve"
  | "require_approval_with_alternatives";

export type Decision =
  | "approved"
  | "rejected"
  | "overridden"
  | "auto_approved"
  | "expired";

export interface Actor {
  type: "user" | "system";
  id: string;
}

export interface DecisionRecord {
  decisionId: string;
  patchSetId: string;
  decision: Decision;
  actor: Actor;
  policyApplied: ApprovalPolicy;
  reason: string;
  timestamp: number;
  consultationTraceRef: string;
}

export type RejectionCategory =
  | "wrong_scope"
  | "wrong_timing"
  | "wrong_values"
  | "unnecessary"
  | "policy_violation"
  | "other";

export interface RejectionCapture {
  decisionRecordId: string;
  reason: string;
  freeText: string;
  suggestedAlternative: string | null;
  rejectionCategory: RejectionCategory;
}

export interface OverrideCapture {
  decisionRecordId: string;
  overrideReason: string;
  overrideActor: Actor;
  riskAcknowledgement: boolean;
  policyViolations: string[];
}

export interface PreconditionViolation {
  opId: string;
  descriptor: string;
  reason: string;
}

export interface PostconditionViolation {
  opId: string;
  descriptor: string;
  reason: string;
}

export interface PreconditionResult {
  passed: boolean;
  failedAt?: string;
  violations: PreconditionViolation[];
  evaluatedCount: number;
}

export interface PostconditionResult {
  passed: boolean;
  violations: PostconditionViolation[];
}

export interface EvaluationContext {
  baseRef?: string;
  [key: string]: unknown;
}

export interface PreconditionEvaluator {
  evaluate(
    op: PatchOp,
    precondition: Precondition,
    state: unknown,
    context?: EvaluationContext,
  ): {
    ok: boolean;
    reason?: string;
  };
}

export interface PostconditionEvaluator {
  evaluate(
    op: PatchOp,
    postcondition: Postcondition,
    preState: unknown,
    postState: unknown,
    context?: EvaluationContext,
  ): { ok: boolean; reason?: string };
}
