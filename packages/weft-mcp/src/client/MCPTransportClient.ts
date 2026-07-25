/**
 * @fileoverview MCP Transport Client — transport abstraction for MCP server communication.
 * @description Provides abstract base + concrete stdio implementation for
 *   MCP JSON-RPC 2.0 communication. Only the `stdio` transport is supported
 *   natively; HTTP/SSE transports require the @modelcontextprotocol/sdk
 *   SSEClientTransport (see DESIGN-NOTES.md §Transport).
 * @module weft-mcp/client
 * @since 0.1.0
 */

import type { MCPConnectionStatus, MCPTransport } from "../types";

// ---------------------------------------------------------------------------
// Transport limits (M1/M3 caps)
// ---------------------------------------------------------------------------

/** Maximum bytes buffered from child stdout between newlines. Prevents OOM from
 *  an oversized or malicious server response. */
const MAX_STDOUT_BUFFER_BYTES = 64 * 1024 * 1024; // 64 MB

/** Maximum bytes written to stdin for a single JSON-RPC request line. Prevents
 *  a caller from sending an unbounded payload to the child process. */
const MAX_REQUEST_LINE_BYTES = 4 * 1024 * 1024; // 4 MB

/** Timeout for the MCP initialize/initialized handshake. */
const HANDSHAKE_TIMEOUT_MS = 10_000;

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
  /** HTTP/SSE endpoint URL (reserved for future SDK integration) */
  endpoint?: string;
  /** Stdio command to spawn */
  command?: string;
  /** Stdio command args */
  args?: string[];
  /** Per-call timeout, default 30 000 ms */
  timeoutMs?: number;
  /** Auto-retry count, default 0 */
  maxRetries?: number;
  /** Extra headers for HTTP/SSE auth (reserved for future SDK integration) */
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
   * Wraps `callTool` with a merged timeout + external abort signal.
   * The per-call timeout (options → config → 30 s default) and the external
   * signal both abort the same internal AbortController — whichever fires first.
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

    // N60: attach error handler BEFORE any await so an ENOENT or spawn failure
    // rejects pending requests rather than emitting an unhandled "error" event
    // that can crash the host process.
    this.process.on("error", (err) => {
      this._status = "inactive";
      for (const [, req] of this.pending) req.reject(err);
      this.pending.clear();
    });

    // M1: cap unbounded stdout buffer — a misbehaving server cannot OOM the host.
    this.process.stdout?.on("data", (chunk: Buffer) => {
      this.buffer += chunk.toString();
      if (this.buffer.length > MAX_STDOUT_BUFFER_BYTES) {
        const err = new Error(
          `MCP stdout buffer overflow: exceeded ${MAX_STDOUT_BUFFER_BYTES} bytes`,
        );
        this._status = "inactive";
        for (const [, req] of this.pending) req.reject(err);
        this.pending.clear();
        this.process?.kill();
        return;
      }
      this.drainBuffer();
    });

    this.process.on("exit", () => {
      this._status = "inactive";
      for (const [, req] of this.pending) {
        req.reject(new Error("MCP process exited unexpectedly"));
      }
      this.pending.clear();
    });

    // N43: perform the MCP initialize / notifications/initialized handshake
    // before declaring the transport active. Without this, the first tools/call
    // arrives before the server has finished its startup sequence, which
    // spec-compliant servers will reject.
    try {
      const initReply = await Promise.race([
        this.rpc("initialize", {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: { name: "weft-mcp", version: "0.1.0" },
        }),
        new Promise<never>((_, rej) =>
          setTimeout(
            () => rej(new Error("MCP initialize handshake timed out")),
            HANDSHAKE_TIMEOUT_MS,
          ),
        ),
      ]);
      if (initReply.isError) {
        throw new Error("MCP server rejected initialize handshake");
      }
      // Notification — no response expected
      this.writeRequest({
        jsonrpc: "2.0",
        method: "notifications/initialized",
        params: {},
      });
    } catch (err) {
      // Clean up on handshake failure so the caller doesn't hold a dead transport
      await this.disconnect().catch(() => undefined);
      throw err;
    }

    this._status = "active";
  }

  async disconnect(): Promise<void> {
    if (this.process) {
      this.process.kill();
      this.process = null;
    }
    // Reject any in-flight requests so callers aren't left hanging
    for (const [, req] of this.pending) {
      req.reject(new Error("Transport disconnected"));
    }
    this.pending.clear();
    this.buffer = "";
    this._status = "inactive";
  }

  // M2: pass the abort signal through to rpc() so cancellation reaches the
  // pending-map entry and the request is cleaned up on caller abort.
  async callTool(
    toolName: string,
    input: unknown,
    options?: MCPCallOptions,
  ): Promise<MCPRawResult> {
    return this.rpc(
      "tools/call",
      { name: toolName, arguments: input },
      options?.signal,
    );
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

  // M3: validate request line size before writing to stdin
  private writeRequest(payload: Record<string, unknown>): void {
    const line = `${JSON.stringify(payload)}\n`;
    if (line.length > MAX_REQUEST_LINE_BYTES) {
      throw new Error(
        `MCP request too large: ${line.length} bytes exceeds ${MAX_REQUEST_LINE_BYTES} limit`,
      );
    }
    this.process!.stdin!.write(line);
  }

  // M2: signal parameter wires caller abort / timeout directly into the
  // pending-map entry so cancellation removes the request cleanly.
  private rpc(
    method: string,
    params: unknown,
    signal?: AbortSignal,
  ): Promise<MCPRawResult> {
    return new Promise((resolve, reject) => {
      if (!this.process?.stdin?.writable) {
        return reject(new Error("Transport is not connected"));
      }

      if (signal?.aborted) {
        return reject(new Error("Request aborted"));
      }

      const id = String(++this.nextId);

      let cleanedUp = false;
      const cleanup = () => {
        if (cleanedUp) return;
        cleanedUp = true;
        signal?.removeEventListener("abort", onAbort);
      };

      const onAbort = () => {
        this.pending.delete(id);
        cleanup();
        reject(new Error("Request aborted by caller signal"));
      };

      if (signal) {
        signal.addEventListener("abort", onAbort, { once: true });
      }

      this.pending.set(id, {
        resolve: (v) => {
          cleanup();
          resolve(v);
        },
        reject: (e) => {
          cleanup();
          reject(e);
        },
      });

      try {
        this.writeRequest({ jsonrpc: "2.0", id, method, params });
      } catch (err) {
        this.pending.delete(id);
        cleanup();
        reject(err as Error);
      }
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
    case "stdio":
      if (!config.command) {
        throw new Error("stdio transport requires command");
      }
      return new StdioMCPTransport({ ...config, command: config.command });

    case "http":
    case "sse":
      // N44/N47: the previous HttpMCPTransport spoke private REST routes
      // (POST /tools/{name}) rather than MCP JSON-RPC, making it incompatible
      // with any spec-compliant server. It has been removed. Use the official
      // @modelcontextprotocol/sdk SSEClientTransport for HTTP/SSE:
      //
      //   import { Client } from "@modelcontextprotocol/sdk/client/index.js";
      //   import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
      //
      // See packages/weft-mcp/src/server/DESIGN-NOTES.md for the migration sketch.
      throw new Error(
        `The '${config.transport}' transport requires the @modelcontextprotocol/sdk ` +
          `SSEClientTransport and is not implemented in the bespoke client. ` +
          `Switch to transport: "stdio" or use the SDK directly.`,
      );

    default:
      throw new Error(
        `Unknown transport: ${(config as MCPTransportConfig).transport}`,
      );
  }
}
