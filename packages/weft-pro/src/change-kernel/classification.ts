import type {
  ClassificationContext,
  ClassifiedConflict,
  Conflict,
  ConflictClass,
  ConflictClassifier,
  ConflictResolution,
  PatchOp,
} from "./types";

export class ClassifierRegistry<O extends PatchOp = PatchOp> {
  private readonly byKind = new Map<string, ConflictClassifier<O>>();

  register(kind: string, classifier: ConflictClassifier<O>): void {
    this.byKind.set(kind, classifier);
  }

  has(kind: string): boolean {
    return this.byKind.has(kind);
  }

  classify(
    conflict: Conflict<O>,
    context?: ClassificationContext,
  ): ClassifiedConflict<O> {
    const classifier = this.byKind.get(conflict.kind);
    if (classifier) {
      const classified = classifier(conflict, context);
      if (classified) {
        return classified;
      }
    }

    return classifyConflict(conflict, context);
  }
}

export const classifierRegistry = new ClassifierRegistry();

function defaultResolutionForClass(
  conflictClass: ConflictClass,
): ConflictResolution {
  if (conflictClass === "policy") {
    return "block";
  }

  if (conflictClass === "structural") {
    return "auto";
  }

  return "escalate";
}

export function classifyConflict<O extends PatchOp>(
  conflict: Conflict<O>,
  context?: ClassificationContext,
): ClassifiedConflict<O> {
  const hints = context?.hints ?? {};
  const hintedClass = hints.class as ConflictClass | undefined;

  let resolvedClass: ConflictClass = "structural";
  if (
    hintedClass === "temporal" ||
    hintedClass === "resource" ||
    hintedClass === "policy"
  ) {
    resolvedClass = hintedClass;
  }

  return {
    ...conflict,
    class: resolvedClass,
    resolution: defaultResolutionForClass(resolvedClass),
  };
}
