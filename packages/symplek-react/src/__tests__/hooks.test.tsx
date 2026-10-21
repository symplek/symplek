import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AgentUnit } from "@symplek/core";
import { useAgent } from "../hooks/useAgent";
import { useConsensus } from "../hooks/useConsensus";
import { useSwarm } from "../hooks/useSwarm";

describe("@symplek/react Agent hooks", () => {
  it("useAgent runs unit and stores tracked result", async () => {
    const { result } = renderHook(() => useAgent<string>());

    await act(async () => {
      await result.current.run(AgentUnit.of("hello"));
    });

    await waitFor(() => {
      expect(result.current.isRunning).toBe(false);
    });

    expect(result.current.error).toBeNull();
    expect(result.current.result?.value).toBe("hello");
  });

  it("useAgent aborts stale run and keeps latest result", async () => {
    const { result } = renderHook(() => useAgent<string>());

    const slow = AgentUnit.from(async (ctx) => {
      await new Promise((resolve) => setTimeout(resolve, 50));
      if (ctx.signal?.aborted) {
        throw new DOMException("Aborted", "AbortError");
      }
      return "slow";
    });

    const fast = AgentUnit.from(async () => "fast");

    act(() => {
      void result.current.run(slow);
    });

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      await result.current.run(fast);
    });

    await waitFor(() => {
      expect(result.current.isRunning).toBe(false);
    });

    expect(result.current.result?.value).toBe("fast");
  });

  it("useSwarm runs units in parallel and captures errors", async () => {
    const { result } = renderHook(() => useSwarm<string>());

    const units = [
      AgentUnit.of("first"),
      AgentUnit.from<string>(async () => {
        throw new Error("unit failure");
      }),
      AgentUnit.of("third"),
    ];

    await act(async () => {
      await result.current.run(units);
    });

    await waitFor(() => {
      expect(result.current.isRunning).toBe(false);
    });

    expect(result.current.results[0]?.value).toBe("first");
    expect(result.current.results[1]).toBeNull();
    expect(result.current.results[2]?.value).toBe("third");
    expect(result.current.errors[1]?.message).toContain("unit failure");
  });

  it("useConsensus runs voting and exposes votes", async () => {
    const { result } = renderHook(() => useConsensus<string>());

    await act(async () => {
      await result.current.run("proposal", [
        () => ({ decision: "approve", confidence: 0.9 }),
        () => ({ decision: "approve", confidence: 0.8 }),
        () => ({ decision: "reject", confidence: 0.7 }),
      ]);
    });

    await waitFor(() => {
      expect(result.current.isRunning).toBe(false);
    });

    expect(result.current.result?.approved).toBe(true);
    expect(result.current.votes).toHaveLength(3);
  });
});
