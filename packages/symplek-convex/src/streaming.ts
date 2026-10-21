import type { FunctionReference, GenericActionCtx } from "convex/server";

/**
 * Configuration for streamToMutation
 */
export interface StreamToMutationConfig {
  /** The mutation to call for each batch of chunks */
  mutation: FunctionReference<"mutation", "public" | "internal">;
  /** Number of chunks to batch before calling the mutation (default: 10) */
  batchSize?: number;
  /** Maximum time in ms to wait before flushing chunks (default: 100ms) */
  batchTimeoutMs?: number;
  /** Extra arguments to pass to the mutation */
  args?: Record<string, unknown>;
}

/**
 * Streams an AsyncGenerator of strings to a Convex mutation.
 * Batches updates by count and/or time to reduce mutation calls.
 *
 * @param ctx The Convex ActionCtx
 * @param stream The stream of text chunks
 * @param config Configuration for the streaming behavior
 */
export async function streamToMutation(
  ctx: GenericActionCtx<any>,
  stream: AsyncIterable<string> | AsyncGenerator<string>,
  config: StreamToMutationConfig,
): Promise<void> {
  const { mutation, batchSize = 10, batchTimeoutMs = 100, args = {} } = config;

  let buffer: string[] = [];
  let flushPromise: Promise<void> | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const flush = async () => {
    if (buffer.length === 0) return;

    const chunks = [...buffer];
    buffer = [];

    if (timer) {
      clearTimeout(timer);
      timer = null;
    }

    await ctx.runMutation(mutation, { ...args, chunks });
  };

  try {
    for await (const chunk of stream) {
      buffer.push(chunk);

      if (buffer.length >= batchSize) {
        if (flushPromise) await flushPromise;
        flushPromise = flush();
      } else if (!timer) {
        timer = setTimeout(() => {
          flushPromise = flush();
        }, batchTimeoutMs);
      }
    }
  } finally {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    if (flushPromise) await flushPromise;
    await flush();
  }
}
