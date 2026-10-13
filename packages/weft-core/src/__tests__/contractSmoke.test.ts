/**
 * Package Contract Smoke Test — weft-core
 *
 * Proves that the package entrypoint (src/index.ts) exports what the
 * package.json contract claims. Imports ONLY from "../index" (the
 * package entrypoint), never from internal modules or workspace aliases.
 *
 * Any export that exists here at runtime is real package truth.
 * Any export that fails to resolve here is a boundary lie.
 */

import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import * as entrypoint from "../index";
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
  WeftError,
} from "../index";

describe("weft-core — Package Contract Smoke", () => {
  describe("Core exports", () => {
    it("exports AgentUnit as a class with static factory methods", () => {
      expect(AgentUnit).toBeDefined();
      expect(typeof AgentUnit.of).toBe("function");
      expect(typeof AgentUnit.from).toBe("function");
      expect(typeof AgentUnit.fromPromise).toBe("function");
    });

    it("exports WeftError as an Error subclass", () => {
      expect(WeftError).toBeDefined();
      expect(new WeftError("test", "UNKNOWN")).toBeInstanceOf(Error);
    });

    it("exports createContext as a function", () => {
      expect(typeof createContext).toBe("function");
      const ctx = createContext({});
      expect(ctx).toBeDefined();
    });

    it("exports VERSION string that matches package.json", () => {
      // B14 fix: compare against the live package.json version rather than a
      // pinned literal so the test fails when the version constant is not updated
      // alongside the manifest.
      const pkgPath = resolve(__dirname, "../../package.json");
      const _require = createRequire(import.meta.url);
      const pkg = _require(pkgPath) as { version: string };
      expect(typeof VERSION).toBe("string");
      expect(VERSION).toBe(pkg.version);
    });
  });

  describe("BOUNDARY TRUTH: Facade is server-only", () => {
    it("Weft is NOT exported from package root (moved to weft-core/server)", () => {
      expect((entrypoint as any).Weft).toBeUndefined();
    });

    it("WeftBuilder is NOT exported from package root", () => {
      expect((entrypoint as any).WeftBuilder).toBeUndefined();
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
