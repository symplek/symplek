import type { z } from "zod";

/**
 * Tool definition for agents.
 */
export interface Tool<P extends z.ZodType = any, R = any> {
  /** Description of what the tool does, used by the LLM to decide when to call it. */
  description: string;
  /** Zod schema for the tool's parameters. */
  parameters: P;
  /** The implementation of the tool. */
  execute: (params: z.infer<P>) => Promise<R>;
}

/**
 * Helper to define a tool with full type inference.
 */
export function tool<P extends z.ZodType, R>(config: Tool<P, R>): Tool<P, R> {
  return config;
}
