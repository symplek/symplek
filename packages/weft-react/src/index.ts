/**
 * weft-react
 * React hooks and components for Weft
 *
 * NOTE: useAI, useAIQuery, useAIStream are excluded from the browser bundle —
 * they depend on server-only AI provider SDKs. Use Convex actions for AI calls.
 */

export * from "./AIErrorBoundary";
export * from "./AIProvider";
export * from "./hooks/useAgent";
export * from "./hooks/useConsensus";
export * from "./hooks/useSwarm";
