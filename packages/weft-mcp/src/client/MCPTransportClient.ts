/**
 * @fileoverview MCP Transport Client — transport abstraction for MCP server communication.
 * Provides abstract base + concrete stdio/HTTP implementations designed for
 * Convex Actions (`"use node"`).
 * @module @weft/mcp/client
 * @since 0.1.0
 */

import type { MCPConnectionStatus, MCPTransport } from "../types";

// ---------------------------------------------------------------------------
// Descriptor & Config
// ---------------------------------------------------------------------------

export interface MCPToolDescriptor {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

export interface MCPTransportConfig {
  transport: MCPTransport;
  /** HTTP/SSE endpoint URL */
  endpoint?: string;
  /** Stdio command to spawn */
  command?: string;
  /** Stdio command args */
  args?: string[];
  /** Per-call timeout, default 30 000 ms */
  timeoutMs?: number;
  /** Auto-retry count, default 0 */
  maxRetries?: number;
  /** Extra headers for HTTP/SSE auth */
  headers?: Record<string, string>;
}

export interface MCPCallOptions {
  timeout?: number;
  signal?: AbortSignal;
}

export interface MCPRawResult {
  content: unknown;
  isError?: boolean;
  meta?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Abstract base
// ---------------------------------------------------------------------------

export abstract class MCPTransportClient {
  protected readonly _config: MCPTransportConfig;
  protected _status: MCPConnectionStatus = "inactive";

  constructor(config: MCPTransportConfig) {
    this._config = { timeoutMs: 30_000, maxRetries: 0, ...config };
  }

  abstract connect(): Promise<void>;
  abstract disconnect(): Promise<void>;
  abstract callTool(
    toolName: string,
    input: unknown,
    options?: MCPCallOptions,
  ): Promise<MCPRawResult>;
  abstract listTools(): Promise<MCPToolDescriptor[]>;

  get transport(): MCPTransport {
    return this._config.transport;
  }

  get status(): MCPConnectionStatus {
    return this._status;
  }

  get isConnected(): boolean {
    return this._status === "active";
  }

  /**
   * Wraps `callTool` with a timeout derived from options → config → 30 s default.
   * The passed signal (if any) is merged: whichever fires first wins.
   */
  async callToolWithTimeout(
    toolName: string,
    input: unknown,
    options?: MCPCallOptions,
  ): Promise<MCPRawResult> {
    const ms = options?.timeout ?? this._config.timeoutMs ?? 30_000;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ms);

    const onExternalAbort = () => controller.abort();
    options?.signal?.addEventListener("abort", onExternalAbort, { once: true });

    try {
      return await this.callTool(toolName, input, {
        ...options,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
      options?.signal?.removeEventListener("abort", onExternalAbort);
    }
  }
}

// ---------------------------------------------------------------------------
// HTTP / SSE transport
// ---------------------------------------------------------------------------

export class HttpMCPTransport extends MCPTransportClient {
  constructor(
    config: Omit<MCPTransportConfig, "transport"> & { endpoint: string },
  ) {
    super({ ...config, transport: "http" });
  }

  async connect(): Promise<void> {
    if (!this._config.endpoint) {
      throw new Error("HttpMCPTransport requires an endpoint URL");
    }
    this._status = "active";
  }

  async disconnect(): Promise<void> {
    this._status = "inactive";
  }

  async callTool(
    toolName: string,
    input: unknown,
    options?: MCPCallOptions,
  ): Promise<MCPRawResult> {
    if (!this.isConnected) {
      throw new Error("Transport is not connected");
    }

    const response = await fetch(`${this._config.endpoint}/tools/${toolName}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...this._config.headers,
      },
      body: JSON.stringify({ input }),
      signal: options?.signal,
    });

    if (!response.ok) {
      return {
        content: null,
        isError: true,
        meta: { status: response.status, statusText: response.statusText },
      };
    }

    const data: unknown = await response.json();
    return { content: data, isError: false };
  }

  async listTools(): Promise<MCPToolDescriptor[]> {
    if (!this.isConnected) {
      throw new Error("Transport is not connected");
    }

    const response = await fetch(`${this._config.endpoint}/tools`, {
      headers: this._config.headers,
    });

    if (!response.ok) return [];
    return (await response.json()) as MCPToolDescriptor[];
  }
}

// ---------------------------------------------------------------------------
// Stdio transport (JSON-RPC over stdin/stdout)
// ---------------------------------------------------------------------------

interface PendingRequest {
  resolve: (v: MCPRawResult) => void;
  reject: (e: Error) => void;
}

export class StdioMCPTransport extends MCPTransportClient {
  private process: import("child_process").ChildProcess | null = null;
  private pending = new Map<string, PendingRequest>();
  private nextId = 0;
  private buffer = "";

  constructor(
    config: Omit<MCPTransportConfig, "transport"> & { command: string },
  ) {
    super({ ...config, transport: "stdio" });
  }

  async connect(): Promise<void> {
    if (!this._config.command) {
      throw new Error("StdioMCPTransport requires a command");
    }

    const { spawn } = await import("node:child_process");
    this.process = spawn(this._config.command, this._config.args ?? [], {
      stdio: ["pipe", "pipe", "pipe"],
    });

    this.process.stdout?.on("data", (chunk: Buffer) => {
      this.buffer += chunk.toString();
      this.drainBuffer();
    });

    this.process.on("exit", () => {
      this._status = "inactive";
      for (const [, req] of this.pending) {
        req.reject(new Error("MCP process exited unexpectedly"));
      }
      this.pending.clear();
    });

    this._status = "active";
  }

  async disconnect(): Promise<void> {
    if (this.process) {
      this.process.kill();
      this.process = null;
    }
    this._status = "inactive";
  }

  async callTool(
    toolName: string,
    input: unknown,
    _options?: MCPCallOptions,
  ): Promise<MCPRawResult> {
    return this.rpc("tools/call", { name: toolName, arguments: input });
  }

  async listTools(): Promise<MCPToolDescriptor[]> {
    const result = await this.rpc("tools/list", {});
    if (result.isError || !result.content) return [];
    const payload = result.content as { tools?: MCPToolDescriptor[] };
    return payload.tools ?? [];
  }

  // ---- internals ----

  private drainBuffer(): void {
    const lines = this.buffer.split("\n");
    this.buffer = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const msg = JSON.parse(trimmed) as {
          id?: string;
          result?: unknown;
          error?: Record<string, unknown>;
        };
        if (msg.id == null) continue;
        const req = this.pending.get(String(msg.id));
        if (!req) continue;
        this.pending.delete(String(msg.id));

        if (msg.error) {
          req.resolve({ content: null, isError: true, meta: msg.error });
        } else {
          req.resolve({ content: msg.result, isError: false });
        }
      } catch {
        // incomplete or non-JSON line, skip
      }
    }
  }

  private rpc(method: string, params: unknown): Promise<MCPRawResult> {
    return new Promise((resolve, reject) => {
      if (!this.process?.stdin?.writable) {
        return reject(new Error("Transport is not connected"));
      }

      const id = String(++this.nextId);
      this.pending.set(id, { resolve, reject });
      this.process.stdin.write(
        `${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`,
      );
    });
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createTransport(
  config: MCPTransportConfig,
): MCPTransportClient {
  switch (config.transport) {
    case "http":
    case "sse":
      if (!config.endpoint) {
        throw new Error("HTTP/SSE transport requires endpoint");
      }
      return new HttpMCPTransport({ ...config, endpoint: config.endpoint });
    case "stdio":
      if (!config.command) {
        throw new Error("stdio transport requires command");
      }
      return new StdioMCPTransport({ ...config, command: config.command });
    default:
      throw new Error(
        `Unknown transport: ${(config as MCPTransportConfig).transport}`,
      );
  }
}
