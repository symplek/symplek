import type { z } from "zod";
import { type AIOptions, type AIPrompt, type AIResult, ai } from "./ai";

/**
 * Result of a single task in non-fail-fast parallel execution.
 * Replaces the `undefined as any` type hole.
 *
 * ⚠️ FIX-GUARD[FP-PARALLEL-TYPEHOLE-20260313]: Was `undefined as any`.
 */
export type ParallelTaskResult<T extends z.ZodType = any> =
  | { status: "fulfilled"; value: AIResult<T> }
  | { status: "rejected"; error: unknown };

/**
 * Parallel execution of multiple AI prompts.
 *
 * @deprecated Use `AgentUnit.zipAll()` for type-safe parallel composition.
 * Scheduled for removal in v2.0.0.
 *
 * @example Migration:
 * ```typescript
 * // Before (deprecated):
 * const results = await parallel([prompt1, prompt2]);
 *
 * // After (preferred):
 * const results = await AgentUnit.zipAll([unit1, unit2]).run(ctx);
 * ```
 */
export async function parallel<T extends z.ZodType = any>(
  prompts: (string | AIPrompt<T>)[],
  globalOptions?: AIOptions<T>,
): Promise<AIResult<T>[]>;
/**
 * @deprecated Non-fail-fast overload. Use `AgentUnit.zipAll()` instead.
 *
 * ⚠️ FIX-GUARD[FP-PARALLEL-TYPEHOLE-20260313]: Returns `(AIResult | undefined)[]`
 * for non-fail-fast — `undefined` slots replace the old `undefined as any` hole.
 */
export async function parallel<T extends z.ZodType = any>(
  prompts: (string | AIPrompt<T>)[],
  globalOptions: AIOptions<T> & { failFast: false },
): Promise<(AIResult<T> | undefined)[]>;
export async function parallel<T extends z.ZodType = any>(
  prompts: (string | AIPrompt<T>)[],
  globalOptions?: AIOptions<T>,
): Promise<AIResult<T>[] | (AIResult<T> | undefined)[]> {
  console.warn(
    "[Weft] parallel() is deprecated. Use AgentUnit.zipAll() instead. " +
      "Scheduled for removal in v2.0.0.",
  );

  const failFast = globalOptions?.failFast ?? true;

  const tasks = prompts.map(async (p) => {
    const prompt = typeof p === "string" ? p : p.prompt;
    const options =
      typeof p === "string"
        ? globalOptions
        : { ...globalOptions, ...p.options };
    return ai(prompt, options);
  });

  if (failFast) {
    return Promise.all(tasks);
  }

  const results = await Promise.allSettled(tasks);
  return results.map((result, index): AIResult<T> | undefined => {
    if (result.status === "fulfilled") {
      return result.value;
    }
    console.error(`[Weft] Parallel task ${index} failed:`, result.reason);
    return undefined;
  });
}
