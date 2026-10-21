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
import { VERSION } from "../version";

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
    // MCP spec: unknown tool name is an invalid-params error (-32602), not
    // method-not-found (-32601). The method "tools/call" exists; the tool name is
    // the invalid parameter.
    const err = new Error(`Unknown tool: ${name}`) as Error & { code: number };
    err.code = -32602;
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
        serverInfo: { name: "symplek", version: VERSION },
      };

    case "notifications/initialized":
    case "initialized": // backward-compat: some clients omit the "notifications/" prefix
    case "notifications/cancelled":
    case "notifications/progress":
    case "notifications/roots/list_changed":
      // Notifications — no response needed. Return undefined; caller suppresses.
      return undefined;

    case "ping":
      // MCP spec requires an empty result object for ping.
      return {};

    case "tools/list":
      return {
        tools: SYMPLEK_MCP_TOOLS.map((t) => ({
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema,
        })),
      };

    case "tools/call": {
      // Validate params before accessing — missing or non-object params would
      // otherwise cause a TypeError (-32603 Internal error) instead of the
      // correct -32602 Invalid params.
      const params = request.params;
      if (
        params == null ||
        typeof params !== "object" ||
        Array.isArray(params)
      ) {
        throw new ValidationError(
          "tools/call: params must be an object with a 'name' field",
        );
      }
      const { name, arguments: args } = params as {
        name?: unknown;
        arguments?: unknown;
      };
      if (typeof name !== "string") {
        throw new ValidationError("tools/call: params.name must be a string");
      }
      const output = await dispatchTool(name, args ?? {});
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
 * True when a JSON-RPC method is inherently a notification and must never
 * receive a response, even if a misbehaving client attaches an id to it.
 * The MCP spec treats every "notifications/*" method as notification-only.
 */
function isNotificationMethod(method: string): boolean {
  return (
    method === "initialized" ||
    method.startsWith("notifications/") ||
    method.startsWith("$/")
  );
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

    // ── Parse ──────────────────────────────────────────────────────────────
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      writeResponse({
        jsonrpc: "2.0",
        id: null,
        error: { code: -32700, message: "Parse error" },
      });
      return;
    }

    // ── Validate message shape ─────────────────────────────────────────────
    // M4/Smaller: JSON.parse("null") returns null; JSON.parse("[1]") returns an
    // array. Both crash on `parsed.method`. Guard before any property access.
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      writeResponse({
        jsonrpc: "2.0",
        id: null,
        error: { code: -32600, message: "Invalid Request" },
      });
      return;
    }

    const raw = parsed as Record<string, unknown>;

    // Smaller: messages without jsonrpc:"2.0" must be rejected.
    if (raw.jsonrpc !== "2.0") {
      writeResponse({
        jsonrpc: "2.0",
        id: null,
        error: {
          code: -32600,
          message: "Invalid Request: jsonrpc must be \"2.0\"",
        },
      });
      return;
    }

    // Smaller: a client response has `result` or `error` but no `method`.
    // Silently ignore — responding to a response is not valid JSON-RPC.
    if (typeof raw.method !== "string") {
      return;
    }

    // Smaller: id must be string, number, null, or absent. Object/array ids are
    // invalid per JSON-RPC 2.0 §4 and must be rejected.
    const rawId = raw.id;
    if (
      rawId !== undefined &&
      rawId !== null &&
      typeof rawId !== "string" &&
      typeof rawId !== "number"
    ) {
      writeResponse({
        jsonrpc: "2.0",
        id: null,
        error: {
          code: -32600,
          message: "Invalid Request: id must be string, number, or null",
        },
      });
      return;
    }

    const id = rawId === undefined ? null : (rawId as string | number | null);

    // M5/Smaller: a message is a notification when it has no `id` field (id is
    // undefined in the raw object). Notification-only methods must also never
    // get a response even if a misbehaving client attaches an id.
    // JSON-RPC 2.0 §4.1: "A Notification is a Request object without an 'id'."
    const hasId = rawId !== undefined;
    const isNotif = !hasId || isNotificationMethod(raw.method as string);

    const request: JsonRpcRequest = {
      jsonrpc: "2.0",
      id: rawId as string | number | null | undefined,
      method: raw.method as string,
      params: raw.params,
    };

    handleRequest(request).then(
      (result) => {
        // Notifications never get a response — not even on success.
        if (isNotif) return;
        // Ensure the `result` field is always present (not undefined) so the
        // JSON serialiser includes it. JSON.stringify omits undefined fields.
        writeResponse({ jsonrpc: "2.0", id, result: result ?? null });
      },
      (error: unknown) => {
        // Notifications never get error responses either.
        if (isNotif) return;

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
