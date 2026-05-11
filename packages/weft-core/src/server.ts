/**
 * @module server - Server-only exports for weft-core
 * @description Honest package boundary for Node/Convex consumers that need runtime AI utilities.
 *   Everything here pulls provider SDKs and must NOT be re-exported from the
 *   browser-safe package root.
 * @rules @.cursor/rules/patterns/029-file-header-contracts.mdc
 * @runtime node
 * @surface server:public
 */

export type { AgentConfig } from "./agent";
// ── Agent builder ────────────────────────────────────────────────────────────
export { AgentBuilder } from "./agent";
export type { AIOptions, AIPrompt, AIResult } from "./ai";
// ── AI runtime ──────────────────────────────────────────────────────────────
export { ai } from "./ai";
export type { WeftOptions } from "./builder";
// ── WeftBuilder (core execution primitive) ───────────────────────────────────
export { WeftBuilder } from "./builder";
export type { ProviderInfo, WeftConfigOptions, WeftFunction } from "./facade";
// ── Weft callable namespace (real execution backed by ai()) ─────────────────
export { Weft } from "./facade";

export type {
  AIMessage,
  AIRequest,
  AIResponse,
  AIUsage,
  Provider,
  ProviderCapabilities,
  ProviderId,
  StreamChunk,
} from "./providers/interface";
export { ProviderRegistry, providerRegistry } from "./providers/registry";
export type { StreamOptions } from "./streaming";
export { stream } from "./streaming";
