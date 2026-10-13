/**
 * @module parity-pro — CR-201 export-parity gate
 * @description Asserts that every runtime value @symplek/pro exposes for the
 *   confidence, coherence, interview, change-kernel, and operator subsystems
 *   is also accessible from the corresponding @symplek/core subpath export.
 *
 * Purpose: prevent a re-export collapse regression where @symplek/pro keeps a
 * symbol that @symplek/core's subpath no longer provides.
 *
 * Note: @symplek/pro/src/types.ts type-only symbols (ConvergeContribution etc.)
 * are erased at runtime and therefore not in this runtime-value list.
 * Their structural correctness is enforced by the @symplek/pro typecheck.
 */
import { describe, expect, it } from "vitest";
import * as CoreConfidence from "../confidence/index";
import * as CoreCoherence from "../coherence/index";
import * as CoreInterview from "../interview/index";
import * as CoreChangeKernel from "../change-kernel/index";
import * as CoreOperators from "../operators/index";

// ─── CONFIDENCE ──────────────────────────────────────────────────────────────
// Runtime values @symplek/pro exposed from its confidence barrel (pre-collapse):
const PRO_CONFIDENCE_VALUES = [
  "CONFIDENCE_THRESHOLDS",
  "calculateAgreementRate",
  "calculateEntropyConfidence",
  "calculateObjectiveConfidence",
  "calculateRetryConfidence",
  "calculateVarianceConfidence",
  "calculateVerificationDepthConfidence",
  "DEFAULT_WEIGHTS",
  "getConfidenceTier",
  "getPresetWeights",
  "isUnanimous",
  "meetsThreshold",
  "normalizeWeights",
  "quickConfidence",
  "shannonEntropy",
  "simpleAgreementRate",
  "simpleVariance",
  "validateWeights",
  "WEIGHT_PRESETS",
] as const;

describe("CR-201 parity: confidence", () => {
  const coreKeys = Object.keys(CoreConfidence);
  for (const sym of PRO_CONFIDENCE_VALUES) {
    it(`core/confidence exports "${sym}"`, () => {
      expect(coreKeys).toContain(sym);
    });
  }
});

// ─── COHERENCE ───────────────────────────────────────────────────────────────
const PRO_COHERENCE_VALUES = [
  "COHERENCE_ALGORITHM_VERSION",
  "COHERENCE_PRESETS",
  "COHERENCE_THRESHOLDS",
  "calculateCompositeCoherence",
  "calculateEntropyCoherence",
  "calculateEntropyCoherenceFromProbabilities",
  "calculateVarianceCoherence",
  "calculateVarianceCoherenceFromConfidences",
  "DEFAULT_COHERENCE_WEIGHTS",
  "getPresetFromThreshold",
  "hasContributions",
  "hasVotes",
  "meetsCoherenceThreshold",
  "mergeWeights",
  "normalizeWeights",
  "quickCoherence",
  "resolveThreshold",
  "validateWeightSum",
] as const;

describe("CR-201 parity: coherence", () => {
  const coreKeys = Object.keys(CoreCoherence);
  for (const sym of PRO_COHERENCE_VALUES) {
    it(`core/coherence exports "${sym}"`, () => {
      expect(coreKeys).toContain(sym);
    });
  }
});

// ─── INTERVIEW ───────────────────────────────────────────────────────────────
const PRO_INTERVIEW_VALUES = [
  "analyzeSchema",
  "createConductComputation",
  "createDefaultEvaluator",
  "createDefaultExtractor",
  "createDefaultQuestioner",
  "createInterviewComputation",
  "Interview",
] as const;

describe("CR-201 parity: interview", () => {
  const coreKeys = Object.keys(CoreInterview);
  for (const sym of PRO_INTERVIEW_VALUES) {
    it(`core/interview exports "${sym}"`, () => {
      expect(coreKeys).toContain(sym);
    });
  }
});

// ─── CHANGE-KERNEL ───────────────────────────────────────────────────────────
const PRO_CHANGE_KERNEL_VALUES = [
  "ApprovalPolicyRegistry",
  "approvalPolicyRegistry",
  "getApprovalPolicy",
  "routeToGate",
  "createDecisionRecord",
  "queryDecisionsByPatch",
  "enforceLinkageInvariant",
  "captureRejection",
  "captureOverride",
  "getRejectionsByCategory",
  "__clearApprovalStoresForTests",
  "ClassifierRegistry",
  "classifierRegistry",
  "classifyConflict",
  "preconditionEvaluators",
  "postconditionEvaluators",
  "evaluatePreconditions",
  "evaluatePostconditions",
  "ConsultationRouterRegistry",
  "consultationRouterRegistry",
  "routeConsultation",
  "runConsultationWithBudget",
  "validateConsultationTrace",
  "convertDecisionToPatchSet",
  "escalateConflicts",
  "mergePatchSets",
  "PayloadValidatorRegistry",
  "payloadValidators",
  "validatePatchSet",
  "serializePatchSet",
  "deserializePatchSet",
] as const;

describe("CR-201 parity: change-kernel", () => {
  const coreKeys = Object.keys(CoreChangeKernel);
  for (const sym of PRO_CHANGE_KERNEL_VALUES) {
    it(`core/change-kernel exports "${sym}"`, () => {
      expect(coreKeys).toContain(sym);
    });
  }
});

// ─── OPERATORS ───────────────────────────────────────────────────────────────
const PRO_OPERATOR_VALUES = [
  "CoherenceError",
  "createCoherenceComputation",
  "createConvergeComputation",
  "createDebateComputation",
  "createDialecticComputation",
  "createSoloComputation",
  "extractSignals",
] as const;

describe("CR-201 parity: operators", () => {
  const coreKeys = Object.keys(CoreOperators);
  for (const sym of PRO_OPERATOR_VALUES) {
    it(`core/operators exports "${sym}"`, () => {
      expect(coreKeys).toContain(sym);
    });
  }
});
