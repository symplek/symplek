/**
 * @fileoverview Loop control for multi-step agent execution
 * @description Implements the loop mechanism for agents that need to perform multiple steps.
 */

import type { AIMessage } from "./providers";

/**
 * Information about the current step in a loop.
 */
export interface StepInfo {
  /** 1-based step number */
  stepNumber: number;
  /** Conversation history including this step's messages */
  messages: AIMessage[];
  /** Results from tool executions in this step */
  toolResults: unknown[];
  /** The last text response from the model */
  lastResponse?: string;
}

/**
 * Modifications to apply to the next step.
 */
export interface StepModifications {
  /** Override or append to messages */
  messages?: AIMessage[];
  /** Override tools for this step */
  tools?: unknown[];
  /** Override model for this step */
  model?: string;
}

/**
 * Options for controlling the execution loop.
 */
export interface LoopOptions {
  /** Maximum number of steps to execute (default: 5) */
  maxSteps?: number;
  /** Function to determine if the loop should stop */
  stopWhen?: (step: StepInfo) => boolean;
  /** Function to prepare or modify the next step based on previous results */
  prepareStep?: (
    step: StepInfo,
  ) => Promise<StepModifications> | StepModifications;
}

/**
 * Built-in stop conditions for the loop.
 */
export const stopWhen = {
  /** Stop when a specific number of steps is reached */
  maxSteps: (n: number) => (step: StepInfo) => step.stepNumber >= n,
  /** Stop when no more tool calls are generated */
  noToolCalls: () => (step: StepInfo) => step.toolResults.length === 0,
  /** Stop when the response contains specific text */
  containsText: (text: string) => (step: StepInfo) =>
    step.lastResponse?.includes(text) ?? false,
  /** Use a custom stop condition function */
  custom: (fn: (step: StepInfo) => boolean) => fn,
};

/**
 * Default loop options.
 */
export const DEFAULT_LOOP_OPTIONS: Required<Pick<LoopOptions, "maxSteps">> = {
  maxSteps: 5,
};
