/**
 * @module McpServer - Symplek operators as MCP tools for Claude Code/Cursor integration
 * @description Exposes symplek_debate, symplek_consensus, and symplek_tracked as MCP tools
 * via a manual stdio JSON-RPC 2.0 transport. @modelcontextprotocol/sdk is listed as
 * a devDependency but is not required at runtime — the transport is self-contained.
 * @rules @.cursor/rules/patterns/029-file-header-contracts.mdc
 */

import { createInterface } from "node:readline";
import { consensusTool } from "./tools/consensus.tool";
import { debateTool } from "./tools/debate.tool";
import { trackedTool } from "./tools/tracked.tool";
import type { JsonSchemaLike } from "./validateInput";
import { ValidationError, validateInput } from "./validateInput";

export { debateTool, consensusTool, trackedTool };

export const SYMPLEK_MCP_TOOLS = [debateTool, consensusTool, trackedTool] as const;

export type SymplekMcpTool = (typeof SYMPLEK_MCP_TOOLS)[number];

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
  const tool = SYMPLEK_MCP_TOOLS.find((t) => t.name === name);
  if (!tool) {
    const err = new Error(`Unknown tool: ${name}`) as Error & { code: number };
    err.code = -32601;
    throw err;
  }
  // Validate at the JSON-RPC boundary — the tool's TypeScript shape is not
  // enforced at runtime, so untyped MCP callers could otherwise pass anything.
  // ValidationError carries JSON-RPC code -32602 and a precise path/reason.
  // Tool inputSchemas use literal-string `type` fields (e.g. `type: "object"`)
  // without `as const`, so TS sees them as plain `string`. validateInput
  // narrows at runtime regardless; the cast asserts the structural intent.
  validateInput(args, tool.inputSchema as unknown as JsonSchemaLike);
  return tool.execute(args as never);
}

async function handleRequest(request: JsonRpcRequest): Promise<unknown> {
  switch (request.method) {
    case "initialize":
      return {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "symplek", version: "0.1.0" },
      };

    case "notifications/initialized":
    case "initialized": // backward-compat: some clients omit the "notifications/" prefix
      // Notification — no response needed.
      return undefined;

    case "tools/list":
      return {
        tools: SYMPLEK_MCP_TOOLS.map((t) => ({
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
 * Start the Symplek MCP server.
 * Exposes Symplek operators as MCP tools for Claude Code / Cursor / Codex CLI.
 *
 * Uses a minimal stdio JSON-RPC 2.0 transport (newline-delimited JSON).
 * Add to your .claude/settings.json:
 * ```json
 * { "mcpServers": { "symplek": { "command": "node", "args": ["./node_modules/@symplek/mcp/dist/bin.cjs"] } } }
 * ```
 */
export async function startSymplekMcpServer(): Promise<void> {
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
        // Notifications have no id and no response. Suppress for both the spec
        // name ("notifications/initialized") and the legacy short form ("initialized")
        // that some clients send. A result of undefined with id:null would produce
        // a malformed JSON-RPC response {"jsonrpc":"2.0","id":null} with no result field.
        if (
          request.id === undefined &&
          (request.method === "notifications/initialized" ||
            request.method === "initialized")
        )
          return;
        writeResponse({ jsonrpc: "2.0", id, result });
      },
      (error: unknown) => {
        // Sanitise the error surface for MCP callers. We expose:
        //   - The code (so callers can branch on -32601 / -32602 / -32603)
        //   - A short message for our own thrown errors (ValidationError, etc.)
        //   - A generic message for anything else (no stack traces, no internals)
        const code =
          typeof (error as { code?: number }).code === "number"
            ? (error as { code: number }).code
            : -32603;
        const isOwnError =
          error instanceof ValidationError ||
          (error instanceof Error &&
            typeof (error as { code?: number }).code === "number");
        const message = isOwnError
          ? (error as Error).message
          : "Internal error";
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

// Binary startup is handled by src/server/bin.ts, which calls startSymplekMcpServer()
// unconditionally and is compiled to dist/bin.cjs. The previous import.meta.url
// guard was CJS-unsafe (import.meta is undefined in CommonJS) — see B9 fix.
