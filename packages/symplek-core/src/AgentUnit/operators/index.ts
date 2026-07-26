/**
 * @module AgentUnit/operators/index
 * @description Barrel that applies all prototype augmentations to AgentUnit and
 *   re-exports operator types. Each operator file uses `declare module` to merge
 *   methods onto the AgentUnit interface; `export * from` (vs side-effect `import`)
 *   is required so dts bundlers retain the augmentation files in the rolled-up
 *   .d.ts output.
 * @blast_radius HIGH - Missing this import silently removes all operator methods
 *   at runtime AND drops their type signatures from the public type surface.
 * @status STABLE
 * @runtime node
 * @surface internal
 */

export * from "./compensate";
export * from "./contracts";
export * from "./coordination";
export * from "./interview";
// Side-effect import ensures the prototype augmentation in loop.ts runs even
// in bundled environments where tree-shakers elide `export * from "./loop"`
// when the module has no value exports (loop.ts exports only the interface
// LoopOperatorOptions, which is erased at runtime).
import "./loop";
export * from "./loop";
export * from "./model";
export * from "./parallel";
export * from "./reflection";
export * from "./rehearsal";
// `export * from` (not `import` side-effect) keeps these files in the dts roll-up.
// Files with no named exports contribute zero public surface; the `declare module`
// interface augmentation is what gets picked up by the AgentUnit<T> consumer.
export * from "./resilience";
export * from "./runStandalone";
export * from "./saga";
export * from "./solo";
export * from "./supervised";
export * from "./tracking";
export * from "./transform";
