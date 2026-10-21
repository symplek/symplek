/**
 * Package Contract Smoke Test — @symplek/core
 *
 * Proves that the package entrypoint (src/index.ts) exports what the
 * package.json contract claims. Imports ONLY from "../index" (the
 * package entrypoint), never from internal modules or workspace aliases.
 *
 * Any export that exists here at runtime is real package truth.
 * Any export that fails to resolve here is a boundary lie.
 */

import { describe, expect, it } from "vitest";
import * as entrypoint from "../index";
import * as storeSubpath from "../store";
import {
  AgentUnit,
  CheckpointManager,
  COHERENCE_ALGORITHM_VERSION,
  COHERENCE_PRESETS,
  COHERENCE_THRESHOLDS,
  CONFIDENCE_THRESHOLDS,
  CoherenceError,
  ContractError,
  calculateAgreementRate,
  calculateCompositeCoherence,
  calculateEntropyCoherence,
  calculateEntropyConfidence,
  calculateObjectiveConfidence,
  calculateRetryConfidence,
  calculateVarianceCoherence,
  calculateVarianceConfidence,
  createContext,
  createSoloComputation,
  DEFAULT_COHERENCE_WEIGHTS,
  DEFAULT_WEIGHTS,
  DependencyScheduler,
  DeterminismError,
  defaultLockManager,
  defaultTransactionLogManager,
  defineContract,
  FileStorage,
  InMemoryLockManager,
  InMemoryTransactionLogManager,
  Interview,
  isTracked,
  quickCoherence,
  quickConfidence,
  RecordingLLMInterceptor,
  ReplayDivergenceError,
  ReplayLLMInterceptor,
  resolveModelFromContext,
  SOLO_DEFAULTS,
  SOLO_PRESETS,
  shouldActSolo,
  Team,
  TeamRegistry,
  TestHarness,
  TRACE_SCHEMA_VERSION,
  TraceRecorder,
  TraceReplayer,
  TraceVersionError,
  teams,
  unwrapTracked,
  VERSION,
  VectorClockManager,
  WEIGHT_PRESETS,
  SymplekError,
} from "../index";

describe("@symplek/core — Package Contract Smoke", () => {
  describe("Core exports", () => {
    it("exports AgentUnit as a class with static factory methods", () => {
      expect(AgentUnit).toBeDefined();
      expect(typeof AgentUnit.of).toBe("function");
      expect(typeof AgentUnit.from).toBe("function");
      expect(typeof AgentUnit.fromPromise).toBe("function");
    });

    it("exports SymplekError as an Error subclass", () => {
      expect(SymplekError).toBeDefined();
      expect(new SymplekError("test", "UNKNOWN")).toBeInstanceOf(Error);
    });

    it("exports createContext as a function", () => {
      expect(typeof createContext).toBe("function");
      const ctx = createContext({});
      expect(ctx).toBeDefined();
    });

    it("exports VERSION string", () => {
      expect(typeof VERSION).toBe("string");
      expect(VERSION).toBe("1.0.0-beta.1");
    });
  });

  describe("BOUNDARY TRUTH: Facade is server-only", () => {
    it("Symplek is NOT exported from package root (moved to @symplek/core/server)", () => {
      expect((entrypoint as any).Symplek).toBeUndefined();
    });

    it("SymplekBuilder is NOT exported from package root", () => {
      expect((entrypoint as any).SymplekBuilder).toBeUndefined();
    });
  });

  describe("Teams module exports", () => {
    it("exports Team, TeamRegistry, and teams singleton", () => {
      expect(Team).toBeDefined();
      expect(TeamRegistry).toBeDefined();
      expect(teams).toBeDefined();
    });
  });

  describe("Confidence module exports", () => {
    it("exports calculation functions", () => {
      expect(typeof calculateObjectiveConfidence).toBe("function");
      expect(typeof calculateAgreementRate).toBe("function");
      expect(typeof calculateEntropyConfidence).toBe("function");
      expect(typeof calculateVarianceConfidence).toBe("function");
      expect(typeof calculateRetryConfidence).toBe("function");
      expect(typeof quickConfidence).toBe("function");
    });

    it("exports constants", () => {
      expect(CONFIDENCE_THRESHOLDS).toBeDefined();
      expect(DEFAULT_WEIGHTS).toBeDefined();
      expect(WEIGHT_PRESETS).toBeDefined();
    });
  });

  describe("Coherence module exports", () => {
    it("exports calculation functions", () => {
      expect(typeof calculateCompositeCoherence).toBe("function");
      expect(typeof calculateEntropyCoherence).toBe("function");
      expect(typeof calculateVarianceCoherence).toBe("function");
      expect(typeof quickCoherence).toBe("function");
    });

    it("exports constants and errors", () => {
      expect(COHERENCE_ALGORITHM_VERSION).toBeDefined();
      expect(COHERENCE_PRESETS).toBeDefined();
      expect(COHERENCE_THRESHOLDS).toBeDefined();
      expect(DEFAULT_COHERENCE_WEIGHTS).toBeDefined();
      expect(CoherenceError).toBeDefined();
    });
  });

  describe("Contract validation exports", () => {
    it("exports defineContract and ContractError", () => {
      expect(typeof defineContract).toBe("function");
      expect(ContractError).toBeDefined();
    });
  });

  describe("Interview module exports", () => {
    it("exports Interview class", () => {
      expect(Interview).toBeDefined();
    });
  });

  describe("Solo mechanism exports", () => {
    it("exports solo functions and classes", () => {
      expect(typeof shouldActSolo).toBe("function");
      expect(typeof createSoloComputation).toBe("function");
      expect(SOLO_DEFAULTS).toBeDefined();
      expect(SOLO_PRESETS).toBeDefined();
      expect(InMemoryLockManager).toBeDefined();
      expect(InMemoryTransactionLogManager).toBeDefined();
      expect(defaultLockManager).toBeDefined();
      expect(defaultTransactionLogManager).toBeDefined();
    });
  });

  describe("Rehearsal module exports", () => {
    it("exports rehearsal infrastructure", () => {
      expect(TraceRecorder).toBeDefined();
      expect(TraceReplayer).toBeDefined();
      expect(CheckpointManager).toBeDefined();
      expect(VectorClockManager).toBeDefined();
      expect(DependencyScheduler).toBeDefined();
      expect(RecordingLLMInterceptor).toBeDefined();
      expect(ReplayLLMInterceptor).toBeDefined();
      expect(FileStorage).toBeDefined();
      expect(TestHarness).toBeDefined();
      expect(TRACE_SCHEMA_VERSION).toBeDefined();
    });

    it("exports rehearsal errors", () => {
      expect(DeterminismError).toBeDefined();
      expect(ReplayDivergenceError).toBeDefined();
      expect(TraceVersionError).toBeDefined();
    });
  });

  describe("Utility exports", () => {
    it("exports isTracked and unwrapTracked", () => {
      expect(typeof isTracked).toBe("function");
      expect(typeof unwrapTracked).toBe("function");
    });

    it("exports resolveModelFromContext", () => {
      expect(typeof resolveModelFromContext).toBe("function");
    });
  });

  describe("Durable store exports (CR-403) live on the ./store subpath", () => {
    // Contract decision: Wave 5 capability surface is published on subpaths
    // (./uncertainty, ./rehearsal, ./agent, ./store), never the root barrel.
    // Keeping new surface off the root is what lets boundaryTest and
    // exportCount remain meaningful as the framework grows, so this asserts
    // BOTH where the API lives and where it deliberately does not.
    const durableApi = [
      "createDurableStore",
      "createFileBackend",
      "serializeTrackedResult",
      "deserializeTrackedResult",
      "resume",
    ] as const;

    it("the durable API is reachable from @symplek/core/store", () => {
      const subpath = storeSubpath as unknown as Record<string, unknown>;
      for (const name of durableApi) {
        expect(typeof subpath[name]).toBe("function");
      }
    });

    it("the durable API is absent from the root entrypoint", () => {
      const root = entrypoint as unknown as Record<string, unknown>;
      for (const name of durableApi) {
        expect(root[name]).toBeUndefined();
      }
    });
  });

  describe("BOUNDARY TRUTH: Server-only exports are absent from the root entrypoint", () => {
    it("ai() function is NOT exported from package entrypoint — only type exports exist", () => {
      expect((entrypoint as Record<string, unknown>).ai).toBeUndefined();
    });

    it("providerRegistry is NOT exported from package entrypoint", () => {
      const rootEntrypoint = entrypoint as Record<string, unknown>;
      expect(rootEntrypoint.providerRegistry).toBeUndefined();
      expect(rootEntrypoint.ProviderRegistry).toBeUndefined();
    });
  });
});
