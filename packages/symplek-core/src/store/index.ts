/**
 * @module @symplek/core/store
 * @description Durable execution primitives for @symplek/core (CR-403).
 *
 *   Entry point for the `@symplek/core/store` subpath export.
 *
 *   Exports:
 *   - {@link DurableStoreBackend} — the one interface to implement for durability
 *   - {@link DurableStoreOptions} — the options bundle (idempotency + transactions)
 *   - {@link createDurableStore} — factory: one backend to all stores
 *   - {@link createFileBackend} — reference file-system implementation
 *   - {@link SerializedTrackedResult} — JSON-serializable snapshot of a TrackedResult
 *   - {@link serializeTrackedResult} — serialize for durable storage
 *   - {@link deserializeTrackedResult} — reconstruct a genuine TrackedResult
 *   - {@link resume} — replay a prior run; skips on whole-run cache hit. Per-step
 *                     skipping requires explicit per-step idempotency options.
 *   - {@link ResumeOptions} — options for resume()
 *
 * @since 2.2.0 — CR-403
 */

export type { DurableStoreBackend, DurableStoreOptions } from "./backend";
export type { SerializedTrackedResult } from "./backend";
export { serializeTrackedResult, deserializeTrackedResult } from "./backend";
export { createDurableStore } from "./factory";
export { createFileBackend } from "./file-backend";
export type { ResumeOptions } from "./resume";
export { resume } from "./resume";
