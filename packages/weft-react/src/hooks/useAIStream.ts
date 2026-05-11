import { useCallback, useEffect, useRef, useState } from "react";
import { ai, type StreamOptions } from "weft-core/server";

/**
 * Options for the useAIStream hook.
 */
export interface UseAIStreamOptions extends Omit<StreamOptions, "signal"> {
  /** Callback triggered on successful completion */
  onSuccess?: (fullResponse: string) => void;
  /** Callback triggered on error */
  onError?: (error: Error) => void;
}

/**
 * Result of the useAIStream hook.
 */
export interface UseAIStreamResult {
  /** Function to start the AI stream */
  execute: (
    prompt: string,
    options?: Partial<UseAIStreamOptions>,
  ) => Promise<void>;
  /** Array of accumulated text chunks */
  chunks: string[];
  /** Whether the stream is currently active */
  isStreaming: boolean;
  /** Any error that occurred during the last stream */
  error: Error | null;
  /** Function to abort the current stream */
  abort: () => void;
}

/**
 * Hook for real-time AI response streaming.
 *
 * @returns {UseAIStreamResult} An object containing the stream state and control functions.
 */
export function useAIStream(
  baseOptions: UseAIStreamOptions = {},
): UseAIStreamResult {
  const [chunks, setChunks] = useState<string[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  /**
   * Aborts the current AI stream.
   */
  const abort = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setIsStreaming(false);
  }, []);

  /**
   * Executes the AI stream with the given prompt.
   *
   * @param prompt - The user prompt to send to the AI.
   * @param options - Optional overrides for the stream configuration.
   */
  const execute = useCallback(
    async (prompt: string, options?: Partial<UseAIStreamOptions>) => {
      const combinedOptions = { ...baseOptions, ...options };

      // Abort any existing request
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }

      const controller = new AbortController();
      abortControllerRef.current = controller;

      setChunks([]);
      setIsStreaming(true);
      setError(null);

      try {
        let accumulated = "";

        const stream = ai.stream(prompt, {
          ...combinedOptions,
          signal: controller.signal,
        });

        for await (const chunk of stream) {
          setChunks((prev) => [...prev, chunk]);
          accumulated += chunk;
        }

        setIsStreaming(false);
        combinedOptions.onSuccess?.(accumulated);
      } catch (err) {
        // Don't set error state if it was a user-initiated abort
        if (
          err instanceof Error &&
          (err.name === "AbortError" || err.message.includes("abort"))
        ) {
          return;
        }

        const errorObj = err instanceof Error ? err : new Error(String(err));
        setError(errorObj);
        setIsStreaming(false);
        combinedOptions.onError?.(errorObj);
      } finally {
        if (abortControllerRef.current === controller) {
          abortControllerRef.current = null;
        }
      }
    },
    [baseOptions],
  );

  // Clean up on unmount
  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, []);

  return {
    execute,
    chunks,
    isStreaming,
    error,
    abort,
  };
}
