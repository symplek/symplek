import type { LoopOptions } from "../loop";
import { type AgentResult, executeAgent } from "./executor";
import type { Tool } from "./tool";

/**
 * Configuration for an agent.
 */
export interface AgentConfig {
  /** System instructions for the agent. */
  instructions?: string;
  /** Alternative to instructions - defines the agent's role. */
  persona?: string;
  /** Tools available to the agent. */
  tools?: Record<string, Tool>;
  /** Options for the execution loop. */
  loop?: LoopOptions;
  /** Explicit model name to use. */
  model?: string;
}

/**
 * An agent instance that can be called directly or via .run().
 */
export interface Agent {
  /** Direct call returns the final text response. */
  (prompt: string): Promise<string>;
  /** .run() returns a detailed AgentResult. */
  run(prompt: string): Promise<AgentResult>;
  /** The configuration used to create this agent. */
  config: AgentConfig;
}

/**
 * Creates an agent with the given configuration.
 */
export function createAgent(config: AgentConfig): Agent {
  const agentFn = async (prompt: string) => {
    const result = await executeAgent(prompt, config);
    return result.text;
  };

  const agent = agentFn as Agent;
  agent.config = config;
  agent.run = (prompt: string) => executeAgent(prompt, config);

  return agent;
}
