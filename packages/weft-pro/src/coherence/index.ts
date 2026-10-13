/**
 * @fileoverview Coherence module (re-export from weft-core/coherence)
 * @description License-gated re-export via subpath. Implementation lives in weft-core.
 * @module weft-pro/coherence
 * @since 1.0.0-beta.1
 */

// License gate — fires at import time
import "../license-gate";

export * from "weft-core/coherence";
// Alias normalizeWeights so weft-pro/src/index.ts can pick it up as normalizeCoherenceWeights
export { normalizeWeights as normalizeCoherenceWeights } from "weft-core/coherence";
