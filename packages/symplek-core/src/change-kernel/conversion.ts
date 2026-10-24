import type {
  ConversionResult,
  DecisionPacket,
  PatchOp,
  PatchSet,
  Recommendation,
} from "./types";
import { validatePatchSet } from "./validation";

function flattenRecommendations<O extends PatchOp>(
  recommendations: Recommendation<O>[],
): O[] {
  return recommendations
    .slice()
    .sort((a, b) => a.priority - b.priority)
    .flatMap((recommendation) => recommendation.suggestedOps);
}

export function convertDecisionToPatchSet<O extends PatchOp>(
  packet: DecisionPacket<O>,
  baseRef: string,
): ConversionResult<O> {
  const errors: Array<{ path: string; message: string }> = [];

  if (!baseRef || baseRef.trim().length === 0) {
    errors.push({
      path: "baseRef",
      message: "baseRef is required",
    });
  }

  if (!packet.recommendations || packet.recommendations.length === 0) {
    errors.push({
      path: "recommendations",
      message: "at least one recommendation required",
    });
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  const ops = flattenRecommendations(packet.recommendations);

  const patchSet: PatchSet<O> = {
    patchSetId: packet.decisionId,
    baseRef,
    authorType: "agent",
    consultationTrace: packet.consultationTrace.entries,
    riskTier: packet.riskTier,
    ops,
    confidence: packet.confidence,
    createdAt: Date.now(),
  };

  const validation = validatePatchSet(patchSet);
  if (!validation.ok) {
    return {
      ok: false,
      errors: validation.errors.map((e) => ({
        path: e.path,
        message: e.message,
      })),
    };
  }

  return { ok: true, patchSet };
}
