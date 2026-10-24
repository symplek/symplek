import type {
  ClassifiedConflict,
  EscalationHandlerMap,
  EscalationRequest,
  EscalationResponse,
  EscalationResult,
  PatchOp,
} from "./types";

function rankOptions<O extends PatchOp>(
  conflict: ClassifiedConflict<O>,
): EscalationRequest<O>["options"] {
  if (conflict.class === "policy") {
    return [];
  }

  return [
    {
      rank: 1,
      label: "Keep current",
      description: "Prefer already applied current-state operation",
      patchOps: [conflict.ops[0]],
    },
    {
      rank: 2,
      label: "Apply proposed",
      description: "Prefer new proposed operation",
      patchOps: [conflict.ops[1]],
    },
    {
      rank: 3,
      label: "Manual synthesis",
      description: "Escalate for explicit synthesis of both operations",
      patchOps: conflict.ops,
    },
  ];
}

function defaultDeferredResponse<O extends PatchOp>(): EscalationResponse<O> {
  return {
    status: "deferred",
    actor: { type: "system", id: "default-escalation-handler" },
    reason: "no escalation handler registered for conflict class",
    timestamp: Date.now(),
  };
}

export function escalateConflicts<O extends PatchOp>(
  conflicts: ClassifiedConflict<O>[],
  handlers: EscalationHandlerMap<O>,
): EscalationResult<O> {
  const result: EscalationResult<O> = {
    resolved: [],
    deferred: [],
    blocked: [],
  };

  for (const conflict of conflicts) {
    if (conflict.class === "policy") {
      result.blocked.push({
        conflict,
        response: {
          status: "blocked",
          actor: { type: "system", id: "policy-gate" },
          reason:
            "policy conflicts are blocking and require policy-safe patch revision",
          timestamp: Date.now(),
        },
      });
      continue;
    }

    const request: EscalationRequest<O> = {
      conflict,
      options: rankOptions(conflict),
    };

    const handler = handlers[conflict.class];
    const response = handler ? handler(request) : defaultDeferredResponse<O>();

    if (response.status === "resolved") {
      result.resolved.push({ conflict, response });
    } else if (response.status === "blocked") {
      result.blocked.push({ conflict, response });
    } else {
      result.deferred.push({ conflict, response });
    }
  }

  const accounted =
    result.resolved.length + result.deferred.length + result.blocked.length;
  if (accounted !== conflicts.length) {
    throw new Error(
      `no-silent-drop invariant violated: accounted=${accounted}, input=${conflicts.length}`,
    );
  }

  return result;
}
