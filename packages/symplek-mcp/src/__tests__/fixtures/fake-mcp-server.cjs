/**
 * Fake MCP server for transport tests.
 * Responds to initialize, then returns MCP tool-level errors (result.isError:true)
 * for tools/call requests. Used by transport.test.ts to verify M3 fix in drainBuffer.
 */
"use strict";

const { createInterface } = require("node:readline");

const rl = createInterface({ input: process.stdin, terminal: false });

rl.on("line", (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;

  let msg;
  try {
    msg = JSON.parse(trimmed);
  } catch {
    return;
  }

  // Skip notifications (no id) and client responses (no method)
  if (msg.id === undefined) return;
  if (typeof msg.method !== "string") return;

  if (msg.method === "initialize") {
    process.stdout.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: msg.id,
        result: {
          protocolVersion: "2024-11-05",
          capabilities: { tools: {} },
          serverInfo: { name: "fake-error-server", version: "0" },
        },
      })}\n`,
    );
  } else if (msg.method === "tools/call") {
    // Return an MCP tool-level error: result.isError:true (NOT a JSON-RPC error).
    // This tests the M3 fix in drainBuffer which must propagate isError:true.
    process.stdout.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: msg.id,
        result: {
          content: [{ type: "text", text: "tool execution failed: simulated error" }],
          isError: true,
        },
      })}\n`,
    );
  } else {
    process.stdout.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: msg.id,
        error: { code: -32601, message: `Method not found: ${msg.method}` },
      })}\n`,
    );
  }
});

rl.on("close", () => process.exit(0));
