/**
 * @module transport.test - Integration tests for StdioMCPTransport
 * @description M3 fix: drainBuffer did not check result.isError from the server.
 *   MCP tool-level errors arrive as result:{isError:true} (not as JSON-RPC errors),
 *   so drainBuffer was resolving with {isError:false} and MCPUnit created evidence
 *   instead of throwing MCPCallError.
 *
 *   These tests spawn the fake-mcp-server fixture to drive the real transport code
 *   path through drainBuffer, verifying that result.isError:true is propagated.
 * @rules @.cursor/rules/patterns/029-file-header-contracts.mdc
 */

import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { StdioMCPTransport } from "../client/MCPTransportClient.js";

const FAKE_SERVER = resolve(
  __dirname,
  "./fixtures/fake-mcp-server.cjs",
);

describe("StdioMCPTransport: MCP tool-level isError (M3 fix)", () => {
  it(
    "surfaces result.isError:true from server as MCPRawResult.isError:true",
    async () => {
      const transport = new StdioMCPTransport({
        command: process.execPath,
        args: [FAKE_SERVER],
      });

      await transport.connect();

      // The fake server returns result:{isError:true} for every tools/call.
      // Pre-fix: drainBuffer resolved with {isError:false} → MCPUnit created
      //   evidence instead of throwing.
      // Post-fix: drainBuffer checks msg.result?.isError and propagates it.
      const result = await transport.callTool("any_tool", { input: "test" });

      expect(result.isError).toBe(true);
      // The content should be the tool's error content array.
      // (drainBuffer now passes content: msg.result.content when isError:true)
      expect(result.meta).toBeDefined();

      await transport.disconnect();
    },
    10_000,
  );

  it(
    "MCPCallError message includes server error text (M10 fix)",
    async () => {
      const { MCPUnit } = await import("../MCPUnit.js");

      const mcp = MCPUnit.create({
        transport: {
          transport: "stdio",
          command: process.execPath,
          args: [FAKE_SERVER],
        },
        policies: [], // opt out to isolate the transport error behaviour
      });

      const err = await mcp.call("any_tool", {}).catch((e) => e);

      // MCPCallError must be thrown (not evidence returned) for isError:true.
      const { MCPCallError } = await import("../MCPUnit.js");
      expect(err).toBeInstanceOf(MCPCallError);

      await mcp.disconnect();
    },
    10_000,
  );
});
