import { useCallback, useState } from "react";
import { type AIResult, ai } from "weft-core/server";
import type { z } from "zod";
import { useAIConfig } from "../AIProvider";

/**
 * Options for the useAIQuery hook.
 */
export interface UseAIQueryOptions<T extends z.ZodType> {
  /** The Zod schema to validate the AI response against. */
  schema: T;
  /** Optional system prompt to set context for the AI. */
  system?: string;
  /** Optional provider ID to use (e.g., 'openai', 'anthropic'). */
  provider?: string;
  /** Optional model name to use. If not provided, uses the default from AIProvider. */
  model?: string;
}

/**
 * The return type of the useAIQuery hook.
 */
export interface UseAIQueryResult<T extends z.ZodType> {
  /** Function to execute the AI query with a given prompt. */
  execute: (prompt: string) => Promise<AIResult<T> | null>;
  /** The resulting data from the AI query, parsed according to the schema. */
  result: AIResult<T> | null;
  /** Whether the query is currently in progress. */
  isLoading: boolean;
  /** Any error that occurred during the query. */
  error: Error | null;
}

/**
 * A React hook for performing typed AI queries using a Zod schema.
 *
 * @param options - Configuration options for the query.
 * @returns An object containing the execute function and the current state of the query.
 *
 * @example
 * ```tsx
 * const schema = z.object({ answer: z.string() });
 * const { execute, result, isLoading } = useAIQuery({ schema });
 *
 * return (
 *   <button onClick={() => execute("What is 2+2?")} disabled={isLoading}>
 *     {isLoading ? "Thinking..." : "Calculate"}
 *     {result && <p>Result: {result.answer}</p>}
 *   </button>
 * );
 * ```
 */
export function useAIQuery<T extends z.ZodType>(
  options: UseAIQueryOptions<T>,
): UseAIQueryResult<T> {
  const config = useAIConfig();
  const [result, setResult] = useState<AIResult<T> | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const execute = useCallback(
    async (prompt: string) => {
      setIsLoading(true);
      setError(null);
      try {
        const queryResult = await ai(prompt, {
          schema: options.schema,
          system: options.system,
          provider: options.provider,
          model: options.model || config.defaultModel,
        });
        setResult(queryResult);
        return queryResult;
      } catch (err) {
        const errorInstance =
          err instanceof Error ? err : new Error(String(err));
        setError(errorInstance);
        return null;
      } finally {
        setIsLoading(false);
      }
    },
    [
      options.schema,
      options.system,
      options.provider,
      options.model,
      config.defaultModel,
    ],
  );

  return {
    execute,
    result,
    isLoading,
    error,
  };
}
