/**
 * @fileoverview Coherence module (re-export from @symplek/core/coherence)
 * @description License-gated re-export via subpath. Implementation lives in @symplek/core.
 * @module @symplek/pro/coherence
 * @since 1.0.0-beta.1
 */

// License gate — fires at import time
import "../license-gate";

export * from "@symplek/core/coherence";
// Alias normalizeWeights so @symplek/pro/src/index.ts can pick it up as normalizeCoherenceWeights
export { normalizeWeights as normalizeCoherenceWeights } from "@symplek/core/coherence";
