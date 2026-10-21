/**
 * @module server - Server-only exports for @symplek/core
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
// ── AgentUnit (re-exported so consumers get one namespace) ───────────────────
export type { AgentComputation, AgentUnitMetadata } from "./AgentUnit";
export { AgentUnit } from "./AgentUnit";
export { createContext } from "./context";
export type { AIOptions, AIPrompt, AIResult } from "./ai";
// ── AI runtime ──────────────────────────────────────────────────────────────
export { ai } from "./ai";
export type { SymplekOptions } from "./builder";
// ── SymplekBuilder (core execution primitive) ───────────────────────────────────
export { SymplekBuilder } from "./builder";
export type { ProviderInfo, SymplekConfigOptions, SymplekFunction } from "./facade";
// ── Symplek callable namespace (real execution backed by ai()) ─────────────────
export { Symplek } from "./facade";

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
