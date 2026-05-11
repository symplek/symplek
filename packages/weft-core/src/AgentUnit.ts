/**
 * @module AgentUnit
 * @description Thin barrel — re-exports AgentUnit class and fires all prototype
 *   augmentations via the AgentUnit/ subdirectory side-effect imports.
 *   DO NOT add implementation here; extend via ./AgentUnit/operators/ sub-modules.
 * @blast_radius HIGH - Every agent in the system depends on this export chain
 * @status STABLE
 * @runtime node
 * @surface public
 */

// Re-exports class + types + fires all prototype augmentations
export * from "./AgentUnit/index";
