/**
 * @module binary-startup.test - Packaging contract tests for the weft-mcp binary
 * @description B9 fix: the previous binary entrypoint used `import.meta.url` as a
 *   startup guard, which is `undefined` in CJS (the published bin format), making
 *   the binary inert. These tests catch this class of packaging failure statically
 *   so it is caught before publish rather than by manual testing.
 * @rules @.cursor/rules/patterns/029-file-header-contracts.mdc
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";

const BIN_SRC = resolve(__dirname, "../server/bin.ts");
const binSource = readFileSync(BIN_SRC, "utf-8");

// ─── Static source analysis ───────────────────────────────────────────────────

describe("bin.ts packaging contract (static)", () => {
  it("does not contain an ESM-only startup guard (CJS-unsafe pattern)", () => {
    // The previous server/index.ts guard `if (import.meta.url === \`file://...\`)` is
    // undefined in CommonJS, making the binary inert. We check for the specific
    // guard PATTERN (import.meta.url ===) rather than any mention of import.meta,
    // since comments may legitimately reference the pattern for documentation.
    expect(binSource).not.toMatch(/import\.meta\.url\s*===\s*`/);
  });

  it("calls startWeftMcpServer() unconditionally", () => {
    // The entire purpose of bin.ts is to call startWeftMcpServer() — not to
    // conditionally call it behind an ESM-only guard.
    expect(binSource).toContain("startWeftMcpServer()");
  });

  it("imports startWeftMcpServer from the server index", () => {
    expect(binSource).toContain("startWeftMcpServer");
    expect(binSource).toContain('from "./index');
  });

  it("handles errors and calls process.exit(1)", () => {
    // The binary must not crash silently — unhandled rejections must exit non-zero.
    expect(binSource).toContain("process.exit(1)");
  });
});

// ─── Runtime smoke test ───────────────────────────────────────────────────────

describe("startWeftMcpServer() runtime contract", () => {
  it("resolves when stdin closes (no pending lines)", async () => {
    const { startWeftMcpServer } = await import("../server/index.js");

    // Replace process.stdin with a PassThrough that we control
    const fakeStdin = new PassThrough();
    const realStdin = process.stdin;
    Object.defineProperty(process, "stdin", {
      value: fakeStdin,
      configurable: true,
      writable: true,
    });

    let resolved = false;
    const serverPromise = startWeftMcpServer().then(() => {
      resolved = true;
    });

    // The server should be waiting for input at this point
    expect(resolved).toBe(false);

    // Close stdin — server must resolve cleanly
    fakeStdin.end();

    await expect(serverPromise).resolves.toBeUndefined();
    expect(resolved).toBe(true);

    // Restore
    Object.defineProperty(process, "stdin", {
      value: realStdin,
      configurable: true,
      writable: true,
    });
  });

  it("handles a valid tools/list request before stdin closes", async () => {
    const { startWeftMcpServer } = await import("../server/index.js");

    const fakeStdin = new PassThrough();
    const chunks: string[] = [];
    const realStdout = process.stdout;
    // Capture stdout writes
    const fakeStdout = new PassThrough();
    fakeStdout.on("data", (c: Buffer) => chunks.push(c.toString()));

    const realStdin = process.stdin;
    Object.defineProperty(process, "stdin", {
      value: fakeStdin,
      configurable: true,
      writable: true,
    });
    Object.defineProperty(process, "stdout", {
      value: fakeStdout,
      configurable: true,
      writable: true,
    });

    const serverPromise = startWeftMcpServer();

    // Send a tools/list request
    fakeStdin.write(
      `${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" })}\n`,
    );

    // Small yield so the readline handler processes the line
    await new Promise((resolve) => setTimeout(resolve, 10));

    fakeStdin.end();
    await serverPromise;

    // Restore
    Object.defineProperty(process, "stdin", {
      value: realStdin,
      configurable: true,
      writable: true,
    });
    Object.defineProperty(process, "stdout", {
      value: realStdout,
      configurable: true,
      writable: true,
    });

    const output = chunks.join("");
    const response = JSON.parse(output) as {
      result: { tools: Array<{ name: string }> };
    };
    const toolNames = response.result.tools.map((t) => t.name);

    expect(toolNames).toContain("weft_debate");
    expect(toolNames).toContain("weft_consensus");
    expect(toolNames).toContain("weft_tracked");
  });
});
