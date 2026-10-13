import type {
  EvaluationContext,
  PatchOp,
  Postcondition,
  PostconditionEvaluator,
  PostconditionResult,
  Precondition,
  PreconditionEvaluator,
  PreconditionResult,
} from "./types";

class PreconditionEvaluatorRegistry {
  private readonly evaluators = new Map<string, PreconditionEvaluator>();

  register(prefix: string, evaluator: PreconditionEvaluator): void {
    this.evaluators.set(prefix, evaluator);
  }

  get(prefix: string): PreconditionEvaluator | undefined {
    return this.evaluators.get(prefix);
  }
}

class PostconditionEvaluatorRegistry {
  private readonly evaluators = new Map<string, PostconditionEvaluator>();

  register(prefix: string, evaluator: PostconditionEvaluator): void {
    this.evaluators.set(prefix, evaluator);
  }

  get(prefix: string): PostconditionEvaluator | undefined {
    return this.evaluators.get(prefix);
  }
}

export const preconditionEvaluators = new PreconditionEvaluatorRegistry();
export const postconditionEvaluators = new PostconditionEvaluatorRegistry();

function getPrefix(descriptor: string): string {
  const [prefix] = descriptor.split(":");
  return prefix;
}

const baseRefEvaluator: PreconditionEvaluator = {
  evaluate(
    op: PatchOp,
    precondition: Precondition,
    _state: unknown,
    context?: EvaluationContext,
  ) {
    if (precondition.type !== "baseRef.matches") {
      return { ok: true };
    }

    const expected = precondition.descriptor.split(":")[1];
    const actual = context?.baseRef;
    if (!expected || !actual) {
      return {
        ok: false,
        reason: `baseRef precondition missing expected or actual value for op ${op.opId}`,
      };
    }

    if (expected !== actual) {
      return {
        ok: false,
        reason: `baseRef mismatch for op ${op.opId}: expected ${expected}, got ${actual}`,
      };
    }

    return { ok: true };
  },
};

preconditionEvaluators.register("baseRef.matches", baseRefEvaluator);

export function evaluatePreconditions(
  ops: PatchOp[],
  state: unknown,
  context?: EvaluationContext,
): PreconditionResult {
  let evaluatedCount = 0;

  for (const op of ops) {
    const preconditions = op.preconditions ?? [];
    if (preconditions.length === 0) {
      evaluatedCount += 1;
      continue;
    }

    for (const precondition of preconditions) {
      const evaluator = preconditionEvaluators.get(
        getPrefix(precondition.descriptor),
      );
      if (!evaluator) {
        return {
          passed: false,
          failedAt: op.opId,
          evaluatedCount,
          violations: [
            {
              opId: op.opId,
              descriptor: precondition.descriptor,
              reason: `no evaluator registered for ${precondition.descriptor}`,
            },
          ],
        };
      }

      const result = evaluator.evaluate(op, precondition, state, context);
      evaluatedCount += 1;
      if (!result.ok) {
        return {
          passed: false,
          failedAt: op.opId,
          evaluatedCount,
          violations: [
            {
              opId: op.opId,
              descriptor: precondition.descriptor,
              reason: result.reason ?? "precondition failed",
            },
          ],
        };
      }
    }
  }

  return {
    passed: true,
    evaluatedCount,
    violations: [],
  };
}

function evaluateSinglePostcondition(
  op: PatchOp,
  postcondition: Postcondition,
  preState: unknown,
  postState: unknown,
  context?: EvaluationContext,
) {
  const evaluator = postconditionEvaluators.get(
    getPrefix(postcondition.descriptor),
  );
  if (!evaluator) {
    return {
      ok: false,
      reason: `no evaluator registered for ${postcondition.descriptor}`,
    };
  }

  return evaluator.evaluate(op, postcondition, preState, postState, context);
}

export function evaluatePostconditions(
  ops: PatchOp[],
  preState: unknown,
  postState: unknown,
  context?: EvaluationContext,
): PostconditionResult {
  const violations: PostconditionResult["violations"] = [];

  for (const op of ops) {
    const postconditions = op.postconditions ?? [];
    for (const postcondition of postconditions) {
      const result = evaluateSinglePostcondition(
        op,
        postcondition,
        preState,
        postState,
        context,
      );
      if (!result.ok) {
        violations.push({
          opId: op.opId,
          descriptor: postcondition.descriptor,
          reason: result.reason ?? "postcondition failed",
        });
      }
    }
  }

  return {
    passed: violations.length === 0,
    violations,
  };
}
