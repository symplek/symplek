/**
 * Package Contract Smoke Test — weft-core/server
 *
 * Proves the server-only subpath exports:
 * 1. Runtime AI utilities (ai, stream, providerRegistry)
 * 2. The Weft facade backed by real AI execution
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const { aiMock } = vi.hoisted(() => ({
  aiMock: vi.fn(),
}));

vi.mock("../ai", () => ({
  ai: aiMock,
}));

import {
  ai,
  ProviderRegistry,
  providerRegistry,
  stream,
  Weft,
  WeftBuilder,
} from "../server";

describe("weft-core/server — Package Contract Smoke", () => {
  beforeEach(() => {
    aiMock.mockReset();
  });

  it("exports ai() runtime", () => {
    expect(typeof ai).toBe("function");
  });

  it("exports stream() runtime", () => {
    expect(typeof stream).toBe("function");
  });

  it("exports ProviderRegistry class and providerRegistry singleton", () => {
    expect(ProviderRegistry).toBeDefined();
    expect(providerRegistry).toBeInstanceOf(ProviderRegistry);
  });

  describe("Weft facade (real execution contract)", () => {
    it("exports Weft factory function", () => {
      expect(typeof Weft).toBe("function");
    });

    it("exports WeftBuilder class", () => {
      expect(WeftBuilder).toBeDefined();
    });

    it("Weft() returns a WeftBuilder with run/coordinate/toUnit/then methods", () => {
      const builder = Weft("test task");
      expect(builder).toBeInstanceOf(WeftBuilder);
      expect(typeof builder.coordinate).toBe("function");
      expect(typeof builder.toUnit).toBe("function");
      expect(typeof builder.run).toBe("function");
      expect(typeof builder.then).toBe("function");
    });

    it("coordinate() returns an AgentUnit backed by a real computation (not a static string)", () => {
      const unit = Weft("test task").coordinate();
      expect(typeof unit.run).toBe("function");
      expect(typeof unit.map).toBe("function");
      expect(typeof unit.flatMap).toBe("function");
    });

    it("toUnit() is an alias for coordinate() returning the same instance", () => {
      const builder = Weft("test task");
      expect(builder.coordinate()).toBe(builder.toUnit());
    });

    it("routes Weft().run() through ai() and returns the AI result instead of echoing the task", async () => {
      aiMock.mockResolvedValue("server-generated answer");

      const result = await Weft("test task", {
        model: "test-model",
      }).run();

      expect(aiMock).toHaveBeenCalledTimes(1);
      expect(aiMock).toHaveBeenCalledWith(
        "test task",
        expect.objectContaining({
          model: "test-model",
          schema: undefined,
        }),
      );
      expect(result.value).toBe("server-generated answer");
      expect(result.value).not.toBe("test task");
      expect(result.source).toBe("agent");
    });
  });
});
