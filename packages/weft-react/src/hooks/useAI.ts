import { type AIMessage, ai, type StreamOptions } from "@weft/core/server";
import { useCallback, useRef, useState } from "react";

/**
 * Options for the useAI hook.
 */
export interface UseAIOptions extends StreamOptions {
  /** Callback triggered on successful completion */
  onSuccess?: (response: string) => void;
  /** Callback triggered on error */
  onError?: (error: Error) => void;
  /** Initial conversation history */
  initialMessages?: AIMessage[];
}

/**
 * Hook for chat-like AI interactions with real-time streaming.
 *
 * @returns An object containing:
 * - send: Function to send a new message
 * - messages: Current conversation history
 * - isLoading: Whether a request is in progress
 * - error: Any error that occurred during the last request
 * - retry: Function to retry the last failed message
 * - abort: Function to cancel the current request
 * - clear: Function to reset the message history
 */
export function useAI(options: UseAIOptions = {}) {
  const [messages, setMessages] = useState<AIMessage[]>(
    options.initialMessages || [],
  );
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  /**
   * Aborts the current AI request.
   */
  const abort = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setIsLoading(false);
  }, []);

  /**
   * Clears the message history and resets state.
   */
  const clear = useCallback(() => {
    setMessages([]);
    setError(null);
    setIsLoading(false);
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
  }, []);

  /**
   * Sends a message to the AI.
   *
   * @param content - The user message content
   * @param overrideOptions - Optional overrides for this specific call
   */
  const send = useCallback(
    async (content: string, overrideOptions?: Partial<UseAIOptions>) => {
      const combinedOptions = { ...options, ...overrideOptions };

      // Abort any existing request
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }

      const controller = new AbortController();
      abortControllerRef.current = controller;

      setIsLoading(true);
      setError(null);

      const userMessage: AIMessage = { role: "user", content };
      const assistantPlaceholder: AIMessage = {
        role: "assistant",
        content: "",
      };

      // Add user message and a placeholder for assistant response
      setMessages((prev) => [...prev, userMessage, assistantPlaceholder]);

      try {
        let fullResponse = "";

        const stream = ai.stream(content, {
          ...combinedOptions,
          signal: controller.signal,
        });

        for await (const chunk of stream) {
          fullResponse += chunk;

          // Update the assistant message in the array
          setMessages((prev) => {
            const updated = [...prev];
            const lastIdx = updated.length - 1;
            if (lastIdx >= 0 && updated[lastIdx].role === "assistant") {
              updated[lastIdx] = { ...updated[lastIdx], content: fullResponse };
            }
            return updated;
          });
        }

        setIsLoading(false);
        combinedOptions.onSuccess?.(fullResponse);
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
        setIsLoading(false);
        combinedOptions.onError?.(errorObj);
      } finally {
        // Only clear if this was the active controller
        if (abortControllerRef.current === controller) {
          abortControllerRef.current = null;
        }
      }
    },
    [options],
  );

  /**
   * Retries the last user message.
   */
  const retry = useCallback(async () => {
    // Find the last user message
    const lastUserMessage = [...messages]
      .reverse()
      .find((m) => m.role === "user");

    if (lastUserMessage) {
      // Remove any trailing assistant message that might have errored
      setMessages((prev) => {
        const last = prev[prev.length - 1];
        if (last && last.role === "assistant") {
          return prev.slice(0, -1);
        }
        return prev;
      });

      // Also remove the user message since send will re-add it
      setMessages((prev) => {
        const last = prev[prev.length - 1];
        if (
          last &&
          last.role === "user" &&
          last.content === lastUserMessage.content
        ) {
          return prev.slice(0, -1);
        }
        return prev;
      });

      return send(lastUserMessage.content);
    }
  }, [messages, send]);

  return {
    send,
    messages,
    isLoading,
    error,
    retry,
    abort,
    clear,
  };
}
