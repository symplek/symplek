import type { Conflict, MergeResult, PatchOp, PatchSet } from "./types";

function clonePatchSet<O extends PatchOp>(patchSet: PatchSet<O>): PatchSet<O> {
  return {
    ...patchSet,
    consultationTrace: [...patchSet.consultationTrace],
    ops: patchSet.ops.map((op) => ({
      ...op,
      preconditions: op.preconditions ? [...op.preconditions] : undefined,
      postconditions: op.postconditions ? [...op.postconditions] : undefined,
    })) as O[],
  };
}

function sortOps<O extends PatchOp>(ops: O[]): O[] {
  return [...ops].sort((a, b) => {
    const target = a.targetId.localeCompare(b.targetId);
    if (target !== 0) {
      return target;
    }

    const kind = a.kind.localeCompare(b.kind);
    if (kind !== 0) {
      return kind;
    }

    return a.opId.localeCompare(b.opId);
  });
}

function conflictIdFor(opA: PatchOp, opB: PatchOp): string {
  return `conflict:${opA.targetId}:${opA.kind}:${opA.opId}:${opB.opId}`;
}

function hasSameIdentity(a: PatchOp, b: PatchOp): boolean {
  return a.targetId === b.targetId && a.kind === b.kind;
}

export function mergePatchSets<O extends PatchOp>(
  _base: PatchSet<O>,
  current: PatchSet<O>,
  proposed: PatchSet<O>,
): MergeResult<O> {
  const currentSafe = clonePatchSet(current);
  const proposedSafe = clonePatchSet(proposed);

  if (proposedSafe.ops.length === 0) {
    return {
      merged: currentSafe,
      conflicts: [],
      autoMerged: true,
    };
  }

  if (proposedSafe.baseRef === currentSafe.baseRef) {
    return {
      merged: {
        ...proposedSafe,
        ops: sortOps(proposedSafe.ops),
      },
      conflicts: [],
      autoMerged: true,
    };
  }

  const conflicts: Conflict<O>[] = [];
  const mergedOps: O[] = [];
  const consumedCurrentOps = new Set<string>();

  for (const proposedOp of sortOps(proposedSafe.ops)) {
    const overlap = currentSafe.ops.find((currentOp) =>
      hasSameIdentity(currentOp, proposedOp),
    );

    if (overlap) {
      consumedCurrentOps.add(overlap.opId);
      conflicts.push({
        conflictId: conflictIdFor(overlap, proposedOp),
        targetId: proposedOp.targetId,
        kind: proposedOp.kind,
        ops: [overlap, proposedOp],
      });
      continue;
    }

    mergedOps.push(proposedOp);
  }

  for (const currentOp of sortOps(currentSafe.ops)) {
    if (!consumedCurrentOps.has(currentOp.opId)) {
      mergedOps.push(currentOp);
    }
  }

  const merged = {
    ...proposedSafe,
    baseRef: currentSafe.baseRef,
    ops: sortOps(mergedOps),
  };

  return {
    merged,
    conflicts,
    autoMerged: conflicts.length === 0,
  };
}
