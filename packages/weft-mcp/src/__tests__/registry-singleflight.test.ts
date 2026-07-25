/**
 * @module registry-singleflight.test - MCPRegistry.getClient single-flight tests
 * @description N69: concurrent first calls to getClient must share one connect promise
 *   instead of each spawning an independent child process.
 * @rules @.cursor/rules/patterns/029-file-header-contracts.mdc
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

// ─── Mock createTransport ────────────────────────────────────────────────────
// vi.mock is hoisted to the top of the file. Variables it references must be
// initialized before the factory runs, so we use vi.hoisted() here.

const { mockCreateTransport } = vi.hoisted(() => ({
  mockCreateTransport: vi.fn(),
}));

vi.mock("../client/MCPTransportClient", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../client/MCPTransportClient")>();
  return {
    ...orig,
    createTransport: mockCreateTransport,
  };
});

import { MCPRegistry } from "../client/MCPRegistry";

// ─── Helpers ──────────────────────────────────────────────────────────────────

interface MockClient {
  isConnected: boolean;
  connect: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
  connectCallCount: number;
}

function makeDelayedClient(connectDelayMs = 10): MockClient {
  const client: MockClient = {
    isConnected: false,
    connectCallCount: 0,
    connect: vi.fn(async () => {
      client.connectCallCount++;
      await new Promise((resolve) => setTimeout(resolve, connectDelayMs));
      client.isConnected = true;
    }),
    disconnect: vi.fn(async () => {
      client.isConnected = false;
    }),
  };
  return client;
}

// ─── Single-flight correctness ────────────────────────────────────────────────

describe("MCPRegistry.getClient single-flight (N69)", () => {
  beforeEach(() => {
    mockCreateTransport.mockClear();
  });

  it("concurrent first calls return the same client instance", async () => {
    const registry = new MCPRegistry();
    registry.register("srv", "Test Server", {
      transport: "stdio",
      command: "echo",
    });

    const client = makeDelayedClient(20);
    mockCreateTransport.mockReturnValue(client);

    // Fire three concurrent getClient calls before any resolves
    const [c1, c2, c3] = await Promise.all([
      registry.getClient("srv"),
      registry.getClient("srv"),
      registry.getClient("srv"),
    ]);

    expect(c1).toBe(c2);
    expect(c2).toBe(c3);
  });

  it("createTransport is called exactly once for concurrent first calls", async () => {
    const registry = new MCPRegistry();
    registry.register("srv", "Test Server", {
      transport: "stdio",
      command: "echo",
    });

    const client = makeDelayedClient(10);
    mockCreateTransport.mockReturnValue(client);

    await Promise.all([
      registry.getClient("srv"),
      registry.getClient("srv"),
      registry.getClient("srv"),
    ]);

    // createTransport must be called exactly once regardless of concurrent callers
    expect(mockCreateTransport).toHaveBeenCalledTimes(1);
    expect(client.connectCallCount).toBe(1);
  });

  it("connect() on the child process is called exactly once", async () => {
    const registry = new MCPRegistry();
    registry.register("srv", "Test Server", {
      transport: "stdio",
      command: "echo",
    });

    const client = makeDelayedClient(10);
    mockCreateTransport.mockReturnValue(client);

    await Promise.all([
      registry.getClient("srv"),
      registry.getClient("srv"),
      registry.getClient("srv"),
      registry.getClient("srv"),
    ]);

    expect(client.connect).toHaveBeenCalledTimes(1);
  });

  it("returns the cached client on sequential calls after initial connect", async () => {
    const registry = new MCPRegistry();
    registry.register("srv", "Test Server", {
      transport: "stdio",
      command: "echo",
    });

    const client = makeDelayedClient(5);
    mockCreateTransport.mockReturnValue(client);

    const first = await registry.getClient("srv");
    const second = await registry.getClient("srv");
    const third = await registry.getClient("srv");

    expect(first).toBe(second);
    expect(second).toBe(third);
    expect(mockCreateTransport).toHaveBeenCalledTimes(1);
  });

  it("throws for unregistered server id", async () => {
    const registry = new MCPRegistry();
    await expect(registry.getClient("not-registered")).rejects.toThrow(
      '"not-registered" not registered',
    );
  });

  it("disconnectAll clears the in-flight map so new calls re-connect", async () => {
    const registry = new MCPRegistry();
    registry.register("srv", "Test Server", {
      transport: "stdio",
      command: "echo",
    });

    const client1 = makeDelayedClient(5);
    const client2 = makeDelayedClient(5);
    mockCreateTransport
      .mockReturnValueOnce(client1)
      .mockReturnValueOnce(client2);

    await registry.getClient("srv"); // establishes client1

    await registry.disconnectAll(); // clears clients + connecting map

    // After disconnectAll, a fresh getClient should reconnect with a new client
    const reconnected = await registry.getClient("srv");
    expect(reconnected).toBe(client2);
    expect(mockCreateTransport).toHaveBeenCalledTimes(2);
  });
});

// ─── Pre-fix regression: orphaned child documentation ────────────────────────

describe("pre-fix race regression (N69)", () => {
  it("documents that concurrent calls would previously orphan overwritten clients", () => {
    // Before the fix, the race was:
    //   call A: miss → createTransport() → await connect() …
    //   call B: miss (A not yet in map) → createTransport() → await connect() …
    //   call A: resolves → clients.set(id, clientA)
    //   call B: resolves → clients.set(id, clientB)  ← overwrites clientA
    //   clientA is now orphaned: unreachable by disconnectAll(), alive in OS
    //
    // The single-flight map (this.connecting) eliminates the window: call B
    // finds the inflight promise and joins it instead of spawning a new child.
    expect(true).toBe(true); // documented intent, not a runtime assertion
  });
});
