import type {
  ConsultationPlan,
  ConsultationTrace,
  ImpactTier,
  SpecialistDescriptor,
  ValidationResult,
} from "./types";

export type AdapterConsultationRouter = (
  impact: ImpactTier,
  availableSpecialists: SpecialistDescriptor[],
) => ConsultationPlan | null;

export class ConsultationRouterRegistry {
  private readonly byCapability = new Map<string, AdapterConsultationRouter>();

  register(capability: string, router: AdapterConsultationRouter): void {
    this.byCapability.set(capability, router);
  }

  route(
    capability: string,
    impact: ImpactTier,
    availableSpecialists: SpecialistDescriptor[],
  ): ConsultationPlan | null {
    const router = this.byCapability.get(capability);
    if (!router) {
      return null;
    }

    return router(impact, availableSpecialists);
  }
}

export const consultationRouterRegistry = new ConsultationRouterRegistry();

function budgetForTier(impact: ImpactTier) {
  switch (impact) {
    case "low":
      return {
        maxSpecialists: 2,
        maxLatencyMs: 5000,
        consensusRequired: false,
        includeChallenge: false,
      };
    case "medium":
      return {
        maxSpecialists: 4,
        maxLatencyMs: 10000,
        consensusRequired: false,
        includeChallenge: true,
      };
    case "high":
      return {
        maxSpecialists: Number.POSITIVE_INFINITY,
        maxLatencyMs: 20000,
        consensusRequired: true,
        includeChallenge: true,
      };
    default:
      return {
        maxSpecialists: 2,
        maxLatencyMs: 5000,
        consensusRequired: false,
        includeChallenge: false,
      };
  }
}

export function routeConsultation(
  impact: ImpactTier,
  availableSpecialists: SpecialistDescriptor[],
  requiredSpecialists: string[] = [],
): ConsultationPlan {
  const budget = budgetForTier(impact);

  const required = availableSpecialists.filter((s) =>
    requiredSpecialists.includes(s.id),
  );

  // Fix[N66]: surface an error when a required specialist is unavailable.
  // Previously, unavailable required ids were silently dropped from `selected`
  // yet still echoed into `budget.requiredSpecialists`, producing a plan whose
  // stated requirements could never be satisfied.
  const foundIds = new Set(required.map((s) => s.id));
  const unmet = requiredSpecialists.filter((id) => !foundIds.has(id));
  if (unmet.length > 0) {
    throw new Error(
      `Required specialists unavailable and cannot be consulted: ${unmet.join(", ")}`,
    );
  }

  const remainder = availableSpecialists.filter(
    (s) => !required.some((r) => r.id === s.id),
  );

  const desired =
    budget.maxSpecialists === Number.POSITIVE_INFINITY
      ? remainder.length
      : Math.max(0, budget.maxSpecialists - required.length);

  const selected = [...required, ...remainder.slice(0, desired)];

  // requiredSpecialists in the plan now only contains ids that were actually
  // selected — it is a truthful record, not an echo of the caller's wish list.
  return {
    specialists: selected,
    budget: {
      maxSpecialists: budget.maxSpecialists,
      maxLatencyMs: budget.maxLatencyMs,
      requiredSpecialists: required.map((s) => s.id),
      consensusRequired: budget.consensusRequired,
      includeChallenge: budget.includeChallenge,
    },
    earlyStop: {
      maxLatencyMs: budget.maxLatencyMs,
      timedOut: false,
      consulted: [],
    },
  };
}

export async function runConsultationWithBudget<T>(
  plan: ConsultationPlan,
  run: (specialist: SpecialistDescriptor) => Promise<T>,
): Promise<{ timedOut: boolean; consulted: string[]; results: T[] }> {
  const startedAt = Date.now();
  const consulted: string[] = [];
  const results: T[] = [];

  for (const specialist of plan.specialists) {
    const elapsed = Date.now() - startedAt;
    const remaining = plan.budget.maxLatencyMs - elapsed;
    if (remaining <= 0) {
      return { timedOut: true, consulted, results };
    }

    // Fix[N65]: race each specialist against the remaining wall-clock budget.
    // The pre-await elapsed check alone cannot bound a specialist that hangs
    // after it has started — the race closes that window.
    const deadlineToken = Symbol("consultation_timeout");
    let deadlineTimer: ReturnType<typeof setTimeout> | undefined;
    const deadlinePromise = new Promise<typeof deadlineToken>((resolve) => {
      deadlineTimer = setTimeout(() => resolve(deadlineToken), remaining);
    });

    let outcome: T | typeof deadlineToken;
    try {
      outcome = await Promise.race([run(specialist), deadlinePromise]);
    } finally {
      clearTimeout(deadlineTimer);
    }

    if (outcome === deadlineToken) {
      return { timedOut: true, consulted, results };
    }

    consulted.push(specialist.id);
    results.push(outcome as T);
  }

  return { timedOut: false, consulted, results };
}

export function validateConsultationTrace(
  trace: ConsultationTrace,
): ValidationResult<ConsultationTrace> {
  const errors: Array<{ path: string; message: string }> = [];

  if (!Array.isArray(trace.entries) || trace.entries.length === 0) {
    errors.push({
      path: "entries",
      message: "trace must contain at least one entry",
    });
  }

  for (const [index, entry] of trace.entries.entries()) {
    if (!entry.specialist || entry.specialist.trim().length === 0) {
      errors.push({
        path: `entries[${index}].specialist`,
        message: "specialist must be non-empty",
      });
    }

    if (!entry.reasoning || entry.reasoning.trim().length === 0) {
      errors.push({
        path: `entries[${index}].reasoning`,
        message: "reasoning must be non-empty",
      });
    }

    if (
      typeof entry.confidence !== "number" ||
      entry.confidence < 0 ||
      entry.confidence > 1
    ) {
      errors.push({
        path: `entries[${index}].confidence`,
        message: "confidence must be between 0 and 1",
      });
    }

    if (!Number.isFinite(entry.latencyMs) || entry.latencyMs < 0) {
      errors.push({
        path: `entries[${index}].latencyMs`,
        message: "latencyMs must be >= 0",
      });
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  return { ok: true, value: trace };
}
