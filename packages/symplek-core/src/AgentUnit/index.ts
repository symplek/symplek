/**
 * @module AgentUnit/index
 * @description Re-export barrel for AgentUnit and all operator augmentations.
 *   The side-effect import below fires all prototype augmentations — consumers
 *   MUST import AgentUnit via this barrel (not directly from ./AgentUnit) to
 *   guarantee all operator methods are available.
 * @blast_radius HIGH - Modifying this barrel affects all agent dispatch.
 * @status STABLE
 * @runtime node
 */

// Base class + types
export * from "./AgentUnit";
// Re-export (not side-effect import) to keep operator declaration merges in the
// dts roll-up — see operators/index.ts for the full rationale.
export * from "./operators/index";
