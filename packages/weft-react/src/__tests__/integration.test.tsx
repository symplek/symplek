import {
  act,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from "@testing-library/react";
import { AgentUnit } from "@weft/core";
import React from "react";
import { describe, expect, it, vi } from "vitest";
import {
  AIErrorBoundary,
  AIProvider,
  useAgent,
  useAIConfig,
  useConsensus,
  useSwarm,
} from "../index";

describe("@weft/react root integration", () => {
  it("provides config through AIProvider and useAIConfig", () => {
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <AIProvider
        config={{
          apiKey: "test-key",
          defaultModel: "test-model",
          baseUrl: "https://example.test",
        }}
      >
        {children}
      </AIProvider>
    );

    const { result } = renderHook(() => useAIConfig(), { wrapper });

    expect(result.current).toEqual({
      apiKey: "test-key",
      defaultModel: "test-model",
      baseUrl: "https://example.test",
    });
  });

  it("throws when useAIConfig is used outside AIProvider", () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    expect(() => renderHook(() => useAIConfig())).toThrow(
      "useAIConfig must be used within AIProvider",
    );

    consoleError.mockRestore();
  });

  it("AIErrorBoundary catches render failures and allows reset", () => {
    const onError = vi.fn();

    function Thrower() {
      throw new Error("kaboom");
    }

    function Harness() {
      const [shouldThrow, setShouldThrow] = React.useState(true);

      return (
        <AIErrorBoundary
          fallback={({ error, reset }) => (
            <div>
              <p>{error.message}</p>
              <button
                onClick={() => {
                  setShouldThrow(false);
                  reset();
                }}
                type="button"
              >
                Recover
              </button>
            </div>
          )}
          onError={onError}
        >
          {shouldThrow ? <Thrower /> : <p>Recovered</p>}
        </AIErrorBoundary>
      );
    }

    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    render(<Harness />);

    expect(screen.getByText("kaboom")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Recover" })).toBeTruthy();
    expect(onError).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Recover" }));

    expect(screen.getByText("Recovered")).toBeTruthy();

    consoleError.mockRestore();
  });

  it("useAgent runs a default AgentUnit from the root export", async () => {
    const { result } = renderHook(() => useAgent(AgentUnit.of("hello")));

    await act(async () => {
      await result.current.run();
    });

    await waitFor(() => {
      expect(result.current.isRunning).toBe(false);
    });

    expect(result.current.error).toBeNull();
    expect(result.current.result?.value).toBe("hello");
  });

  it("useConsensus runs default voters and exposes the votes", async () => {
    const { result } = renderHook(() =>
      useConsensus<string>([
        () => ({ decision: "approve", confidence: 0.9 }),
        () => ({ decision: "approve", confidence: 0.8 }),
        () => ({ decision: "reject", confidence: 0.6 }),
      ]),
    );

    await act(async () => {
      await result.current.run("proposal");
    });

    await waitFor(() => {
      expect(result.current.isRunning).toBe(false);
    });

    expect(result.current.result?.approved).toBe(true);
    expect(result.current.votes).toHaveLength(3);
    expect(result.current.votes.map((vote) => vote.decision)).toEqual([
      "approve",
      "approve",
      "reject",
    ]);
  });

  it("useSwarm runs default units and captures partial failures", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    const { result } = renderHook(() =>
      useSwarm<string>([
        AgentUnit.of("first"),
        AgentUnit.from<string>(async () => {
          throw new Error("unit failure");
        }),
        AgentUnit.of("third"),
      ]),
    );

    await act(async () => {
      await result.current.run();
    });

    await waitFor(() => {
      expect(result.current.isRunning).toBe(false);
    });

    expect(result.current.results[0]?.value).toBe("first");
    expect(result.current.results[1]).toBeNull();
    expect(result.current.results[2]?.value).toBe("third");
    expect(result.current.errors[0]).toBeNull();
    expect(result.current.errors[1]?.message).toContain("unit failure");
    expect(result.current.errors[2]).toBeNull();

    consoleError.mockRestore();
  });
});
