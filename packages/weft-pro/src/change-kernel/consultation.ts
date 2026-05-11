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

  const remainder = availableSpecialists.filter(
    (s) => !required.some((r) => r.id === s.id),
  );

  const desired =
    budget.maxSpecialists === Number.POSITIVE_INFINITY
      ? remainder.length
      : Math.max(0, budget.maxSpecialists - required.length);

  const selected = [...required, ...remainder.slice(0, desired)];

  return {
    specialists: selected,
    budget: {
      maxSpecialists: budget.maxSpecialists,
      maxLatencyMs: budget.maxLatencyMs,
      requiredSpecialists,
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
    if (elapsed >= plan.budget.maxLatencyMs) {
      return { timedOut: true, consulted, results };
    }

    consulted.push(specialist.id);
    results.push(await run(specialist));
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
