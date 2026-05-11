/**
 * @module McpServer - Weft operators as MCP tools for Claude Code/Cursor integration
 * @description Exposes weft_debate, weft_consensus, and weft_tracked as MCP tools
 * via a manual stdio JSON-RPC 2.0 transport. @modelcontextprotocol/sdk is listed as
 * a devDependency but is not required at runtime — the transport is self-contained.
 * @rules @.cursor/rules/patterns/029-file-header-contracts.mdc
 */

import { createInterface } from "node:readline";
import { consensusTool } from "./tools/consensus.tool";
import { debateTool } from "./tools/debate.tool";
import { trackedTool } from "./tools/tracked.tool";

export { debateTool, consensusTool, trackedTool };

export const WEFT_MCP_TOOLS = [debateTool, consensusTool, trackedTool] as const;

export type WeftMcpTool = (typeof WEFT_MCP_TOOLS)[number];

// ─── JSON-RPC 2.0 Transport Types ────────────────────────────────────────────

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: string | number | null | undefined;
  method: string;
  params?: unknown;
}

interface JsonRpcSuccess {
  jsonrpc: "2.0";
  id: string | number | null;
  result: unknown;
}

interface JsonRpcError {
  jsonrpc: "2.0";
  id: string | number | null;
  error: { code: number; message: string; data?: unknown };
}

type JsonRpcResponse = JsonRpcSuccess | JsonRpcError;

// ─── Tool Dispatch ────────────────────────────────────────────────────────────

async function dispatchTool(name: string, args: unknown): Promise<unknown> {
  const tool = WEFT_MCP_TOOLS.find((t) => t.name === name);
  if (!tool) {
    const err = new Error(`Unknown tool: ${name}`) as Error & { code: number };
    err.code = -32601;
    throw err;
  }
  return tool.execute(args as never);
}

async function handleRequest(request: JsonRpcRequest): Promise<unknown> {
  switch (request.method) {
    case "initialize":
      return {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "weft", version: "0.1.0" },
      };

    case "initialized":
      // Notification — no response needed.
      return undefined;

    case "tools/list":
      return {
        tools: WEFT_MCP_TOOLS.map((t) => ({
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema,
        })),
      };

    case "tools/call": {
      const params = request.params as { name: string; arguments?: unknown };
      const output = await dispatchTool(params.name, params.arguments ?? {});
      return {
        content: [{ type: "text", text: JSON.stringify(output, null, 2) }],
      };
    }

    default: {
      const err = new Error(`Method not found: ${request.method}`) as Error & {
        code: number;
      };
      err.code = -32601;
      throw err;
    }
  }
}

// ─── stdio Transport ──────────────────────────────────────────────────────────

function writeResponse(response: JsonRpcResponse): void {
  // MCP stdio uses newline-delimited JSON (one JSON object per line).
  process.stdout.write(`${JSON.stringify(response)}\n`);
}

/**
 * Start the Weft MCP server.
 * Exposes Weft operators as MCP tools for Claude Code / Cursor / Codex CLI.
 *
 * Uses a minimal stdio JSON-RPC 2.0 transport (newline-delimited JSON).
 * Add to your .claude/settings.json:
 * ```json
 * { "mcpServers": { "weft": { "command": "node", "args": ["./dist/server/index.js"] } } }
 * ```
 */
export async function startWeftMcpServer(): Promise<void> {
  const rl = createInterface({
    input: process.stdin,
    output: undefined,
    terminal: false,
  });

  rl.on("line", (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;

    let request: JsonRpcRequest;
    try {
      request = JSON.parse(trimmed) as JsonRpcRequest;
    } catch {
      writeResponse({
        jsonrpc: "2.0",
        id: null,
        error: { code: -32700, message: "Parse error" },
      });
      return;
    }

    const id = request.id ?? null;

    handleRequest(request).then(
      (result) => {
        // Notifications (id undefined/null, method "initialized") have no response.
        if (request.id === undefined && request.method === "initialized")
          return;
        writeResponse({ jsonrpc: "2.0", id, result });
      },
      (error: unknown) => {
        const message =
          error instanceof Error ? error.message : "Internal error";
        const code =
          typeof (error as { code?: number }).code === "number"
            ? (error as { code: number }).code
            : -32603;
        writeResponse({
          jsonrpc: "2.0",
          id,
          error: { code, message },
        });
      },
    );
  });

  // Keep the process alive until stdin closes.
  await new Promise<void>((resolve) => {
    rl.on("close", resolve);
    process.stdin.on("end", resolve);
  });
}

// ─── Entry Point ──────────────────────────────────────────────────────────────

// Run as binary when executed directly.
if (import.meta.url === `file://${process.argv[1]}`) {
  startWeftMcpServer().catch((err) => {
    console.error("[weft-mcp] Fatal error:", err);
    process.exit(1);
  });
}
