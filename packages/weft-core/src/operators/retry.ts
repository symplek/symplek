/**
 * @module weft-core/operators/retry
 * @description Retry operator: retries a computation on failure with exponential backoff.
 * @blast_radius LOW
 * @status STABLE
 */

import type { AgentComputation, AgentUnitMetadata } from "../AgentUnit";
import type { AgentContext, RetryOptions } from "../types";

/**
 * Creates a computation that retries on failure with exponential backoff.
 */
export function createRetryComputation<T>(
  innerComputation: AgentComputation<T>,
  _innerMeta: AgentUnitMetadata,
  options: RetryOptions & { maxAttempts: number },
): AgentComputation<T> {
  const {
    maxAttempts,
    baseDelayMs = 100,
    maxDelayMs = 5000,
    jitter = 0.1,
    retryIf,
  } = options;

  return async (ctx: AgentContext): Promise<T> => {
    let lastError: Error | unknown;
    const attempts = maxAttempts;

    for (let attempt = 1; attempt <= attempts; attempt++) {
      try {
        return await innerComputation(ctx);
      } catch (error) {
        lastError = error;

        // Check if we should retry
        if (retryIf && error instanceof Error) {
          if (!retryIf(error, attempt)) {
            throw error;
          }
        }

        // Don't retry on last attempt
        if (attempt === attempts) {
          throw error;
        }

        // Calculate delay with exponential backoff
        const baseDelay = Math.min(
          baseDelayMs * 2 ** (attempt - 1),
          maxDelayMs,
        );
        const jitterAmount = baseDelay * jitter * (Math.random() * 2 - 1);
        const delay = Math.max(0, baseDelay + jitterAmount);

        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }

    throw lastError;
  };
}
