import type { BridgeMessage, DevToolsMessage } from "./types";

export type { DevToolsMessage } from "./types";

/**
 * Emits a message from the web page to the DevTools extension.
 * This is intended to be used within the main application to track
 * Symplek execution events.
 *
 * This entire module tree-shakes in production builds via import.meta.env.DEV
 * guard. When building for production, esbuild/rollup will eliminate all
 * code paths that are unreachable due to the DEV constant being false.
 */
export function emitToDevTools(message: DevToolsMessage): void {
  // Production guard - entire function body eliminated by tree shaking
  if (import.meta.env.DEV && typeof window !== "undefined") {
    const bridgeMessage: BridgeMessage = {
      source: "Symplek-page",
      type: message.type,
      payload: message.payload,
    };
    window.postMessage(bridgeMessage, "*");
  }
}

/**
 * No-op function for production - enables type-safe usage without runtime cost.
 * Consumers can call this without checking environment - tree shaking handles it.
 */
export function emitThinking(
  executionId: string,
  agentName: string,
  thought: string,
): void {
  if (import.meta.env.DEV) {
    emitToDevTools({
      type: "SYMPLEK_THINKING",
      payload: { executionId, agentName, thought, timestamp: Date.now() },
    });
  }
}

/**
 * Emit execution start event to DevTools.
 * No-op in production builds.
 */
export function emitExecutionStart(
  executionId: string,
  workflowName: string,
): void {
  if (import.meta.env.DEV) {
    emitToDevTools({
      type: "SYMPLEK_EXECUTION_START",
      payload: { executionId, workflowName, timestamp: Date.now() },
    });
  }
}

/**
 * Emit execution complete event to DevTools.
 * No-op in production builds.
 */
export function emitExecutionComplete(
  executionId: string,
  result?: unknown,
  error?: string,
): void {
  if (import.meta.env.DEV) {
    emitToDevTools({
      type: "SYMPLEK_EXECUTION_COMPLETE",
      payload: { executionId, timestamp: Date.now(), result, error },
    });
  }
}

// Production warning - this block is eliminated by tree shaking in prod
// but serves as a safety net during development if code leaks
if (import.meta.env.PROD && typeof window !== "undefined") {
  console.warn(
    "[Symplek DevTools] Bridge code detected in production build. " +
      "This should have been eliminated by tree shaking.",
  );
}
