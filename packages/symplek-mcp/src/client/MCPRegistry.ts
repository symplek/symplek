/**
 * @fileoverview MCP Trust Registry — manages server connections, health, and attestation
 * @module @symplek/mcp/client
 * @since 0.1.0
 *
 * 📝 BUILD[F-068/04.07]: Full trust registry with health tracking and connection pooling
 */

import type { MCPConnectionStatus } from "../types";
import type {
  MCPTransportClient,
  MCPTransportConfig,
} from "./MCPTransportClient";
import { createTransport } from "./MCPTransportClient";

// ---------------------------------------------------------------------------
// Entry & Config
// ---------------------------------------------------------------------------

export interface MCPServerEntry {
  id: string;
  name: string;
  config: MCPTransportConfig;
  status: MCPConnectionStatus;
  attested: boolean;
  attestationScope?: string;
  capabilities: string[];
  failureCount: number;
  lastHealthCheckAt?: number;
  lastError?: string;
  maxConcurrency: number;
  currentConcurrency: number;
}

export interface MCPRegistryConfig {
  healthCheckIntervalMs?: number;
  maxFailuresBeforeDegraded?: number;
  maxFailuresBeforeError?: number;
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

/**
 * In-memory MCP server registry with health tracking.
 * Backs Convex persistence through mcpConnections table (Story 04.08).
 */
export class MCPRegistry {
  private servers = new Map<string, MCPServerEntry>();
  private clients = new Map<string, MCPTransportClient>();
  /** N69: in-flight connect promises, keyed by server id. Concurrent first callers
   *  share the same promise instead of each spawning an independent child process. */
  private connecting = new Map<string, Promise<MCPTransportClient>>();
  private config: Required<MCPRegistryConfig>;

  constructor(config: MCPRegistryConfig = {}) {
    this.config = {
      healthCheckIntervalMs: config.healthCheckIntervalMs ?? 60_000,
      maxFailuresBeforeDegraded: config.maxFailuresBeforeDegraded ?? 3,
      maxFailuresBeforeError: config.maxFailuresBeforeError ?? 10,
    };
  }

  register(
    id: string,
    name: string,
    transportConfig: MCPTransportConfig,
    options?: {
      attested?: boolean;
      attestationScope?: string;
      capabilities?: string[];
      maxConcurrency?: number;
    },
  ): MCPServerEntry {
    const entry: MCPServerEntry = {
      id,
      name,
      config: transportConfig,
      status: "inactive",
      attested: options?.attested ?? false,
      attestationScope: options?.attestationScope,
      capabilities: options?.capabilities ?? [],
      failureCount: 0,
      maxConcurrency: options?.maxConcurrency ?? 5,
      currentConcurrency: 0,
    };
    this.servers.set(id, entry);
    return entry;
  }

  /**
   * Return an active transport client for the given server id.
   *
   * N69 fix: the previous implementation had an `await` between the miss check
   * and `this.clients.set`, creating a race window where concurrent first callers
   * each spawned a separate child process. The overwritten clients were then
   * unreachable by `disconnectAll()`, leaking stdio children.
   *
   * The single-flight map (`this.connecting`) ensures that concurrent first callers
   * await the same connect promise and share the resulting client.
   */
  async getClient(id: string): Promise<MCPTransportClient> {
    const entry = this.servers.get(id);
    if (!entry) throw new Error(`MCP server "${id}" not registered`);

    const existing = this.clients.get(id);
    if (existing?.isConnected) return existing;

    // Single-flight: if a connect is already in progress for this id, join it
    const inflight = this.connecting.get(id);
    if (inflight) return inflight;

    const connectPromise = (async (): Promise<MCPTransportClient> => {
      try {
        const client = createTransport(entry.config);
        await client.connect();
        this.clients.set(id, client);
        entry.status = "active";
        entry.lastHealthCheckAt = Date.now();
        return client;
      } finally {
        this.connecting.delete(id);
      }
    })();

    this.connecting.set(id, connectPromise);
    return connectPromise;
  }

  recordFailure(id: string, error?: string): void {
    const entry = this.servers.get(id);
    if (!entry) return;

    entry.failureCount++;
    entry.lastError = error;

    if (entry.failureCount >= this.config.maxFailuresBeforeError) {
      entry.status = "error";
    } else if (entry.failureCount >= this.config.maxFailuresBeforeDegraded) {
      entry.status = "degraded";
    }
  }

  recordSuccess(id: string): void {
    const entry = this.servers.get(id);
    if (!entry) return;

    entry.failureCount = Math.max(0, entry.failureCount - 1);
    if (entry.failureCount < this.config.maxFailuresBeforeDegraded) {
      entry.status = "active";
    }
    entry.lastHealthCheckAt = Date.now();
  }

  getServer(id: string): MCPServerEntry | undefined {
    return this.servers.get(id);
  }

  listServers(filter?: {
    status?: MCPConnectionStatus;
    attested?: boolean;
  }): MCPServerEntry[] {
    let entries = Array.from(this.servers.values());
    if (filter?.status)
      entries = entries.filter((e) => e.status === filter.status);
    if (filter?.attested !== undefined)
      entries = entries.filter((e) => e.attested === filter.attested);
    return entries;
  }

  getHealthSummary(): {
    total: number;
    active: number;
    degraded: number;
    error: number;
    inactive: number;
  } {
    const entries = Array.from(this.servers.values());
    return {
      total: entries.length,
      active: entries.filter((e) => e.status === "active").length,
      degraded: entries.filter((e) => e.status === "degraded").length,
      error: entries.filter((e) => e.status === "error").length,
      inactive: entries.filter((e) => e.status === "inactive").length,
    };
  }

  async disconnectAll(): Promise<void> {
    // Clear in-flight connects so new callers don't join stale promises
    this.connecting.clear();

    for (const [, client] of this.clients) {
      try {
        await client.disconnect();
      } catch {
        /* transport cleanup is best-effort */
      }
    }
    this.clients.clear();
    for (const entry of this.servers.values()) {
      entry.status = "inactive";
      entry.currentConcurrency = 0;
    }
  }
}
