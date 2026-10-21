/**
 * @module binary-startup.test - Packaging contract tests for the @symplek/mcp binary
 * @description B9 fix: the previous binary entrypoint used `import.meta.url` as a
 *   startup guard, which is `undefined` in CJS (the published bin format), making
 *   the binary inert. These tests catch this class of packaging failure statically
 *   so it is caught before publish rather than by manual testing.
 *
 * M14 fix: the original suite only checked source strings in bin.ts; none of the
 *   tests ran the built `dist/bin.cjs`. Added a suite that spawns the real binary
 *   so regressions in the packaged output are caught before publish.
 * @rules @.cursor/rules/patterns/029-file-header-contracts.mdc
 */

import { existsSync, readFileSync } from "node:fs";
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

  it("calls startSymplekMcpServer() unconditionally", () => {
    // The entire purpose of bin.ts is to call startSymplekMcpServer() — not to
    // conditionally call it behind an ESM-only guard.
    expect(binSource).toContain("startSymplekMcpServer()");
  });

  it("imports startSymplekMcpServer from the server index", () => {
    expect(binSource).toContain("startSymplekMcpServer");
    expect(binSource).toContain('from "./index');
  });

  it("handles errors and calls process.exit(1)", () => {
    // The binary must not crash silently — unhandled rejections must exit non-zero.
    expect(binSource).toContain("process.exit(1)");
  });
});

// ─── Runtime smoke test ───────────────────────────────────────────────────────

describe("startSymplekMcpServer() runtime contract", () => {
  it("resolves when stdin closes (no pending lines)", async () => {
    const { startSymplekMcpServer } = await import("../server/index.js");

    // Replace process.stdin with a PassThrough that we control
    const fakeStdin = new PassThrough();
    const realStdin = process.stdin;
    Object.defineProperty(process, "stdin", {
      value: fakeStdin,
      configurable: true,
      writable: true,
    });

    let resolved = false;
    const serverPromise = startSymplekMcpServer().then(() => {
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
    const { startSymplekMcpServer } = await import("../server/index.js");

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

    const serverPromise = startSymplekMcpServer();

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

    expect(toolNames).toContain("symplek_debate");
    expect(toolNames).toContain("symplek_consensus");
    expect(toolNames).toContain("symplek_tracked");
  });

  it("notifications/initialized produces no response (B11 protocol fix)", async () => {
    // Before the fix, method:"notifications/initialized" bypassed the notification
    // suppression check (which only tested for "initialized") and emitted a
    // malformed JSON-RPC response with id:null and no result field.
    const { startSymplekMcpServer } = await import("../server/index.js");

    const fakeStdin = new PassThrough();
    const chunks: string[] = [];
    const realStdout = process.stdout;
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

    const serverPromise = startSymplekMcpServer();

    // Send the spec-compliant notification (no id — MCP notifications never have ids).
    fakeStdin.write(
      `${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`,
    );

    await new Promise((resolve) => setTimeout(resolve, 10));

    // Also send a tools/list so we can verify the server is otherwise working.
    fakeStdin.write(
      `${JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" })}\n`,
    );

    await new Promise((resolve) => setTimeout(resolve, 10));

    fakeStdin.end();
    await serverPromise;

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

    const lines = chunks.join("").split("\n").filter((l) => l.trim());
    // There should be exactly ONE response (the tools/list). No response for the notification.
    expect(lines).toHaveLength(1);
    const response = JSON.parse(lines[0]) as {
      id: number;
      result: { tools: Array<{ name: string }> };
    };
    expect(response.id).toBe(2);
    expect(response.result.tools.length).toBeGreaterThan(0);
  });

  it("notifications/cancelled produces no response (M5 fix)", async () => {
    const { startSymplekMcpServer } = await import("../server/index.js");

    const fakeStdin = new PassThrough();
    const chunks: string[] = [];
    const realStdout = process.stdout;
    const fakeStdout = new PassThrough();
    fakeStdout.on("data", (c: Buffer) => chunks.push(c.toString()));
    const realStdin = process.stdin;

    Object.defineProperty(process, "stdin", { value: fakeStdin, configurable: true, writable: true });
    Object.defineProperty(process, "stdout", { value: fakeStdout, configurable: true, writable: true });

    const serverPromise = startSymplekMcpServer();

    // Send three notification methods; none should produce a response.
    fakeStdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/cancelled", params: { requestId: 99 } })}\n`);
    fakeStdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/progress", params: { progressToken: 1, progress: 50, total: 100 } })}\n`);
    fakeStdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/roots/list_changed" })}\n`);
    // One real request to confirm the server is still running.
    fakeStdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 5, method: "tools/list" })}\n`);

    await new Promise((resolve) => setTimeout(resolve, 20));
    fakeStdin.end();
    await serverPromise;

    Object.defineProperty(process, "stdin", { value: realStdin, configurable: true, writable: true });
    Object.defineProperty(process, "stdout", { value: realStdout, configurable: true, writable: true });

    const lines = chunks.join("").split("\n").filter((l) => l.trim());
    // Exactly ONE response: the tools/list. No responses for the three notifications.
    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0]) as { id: number };
    expect(parsed.id).toBe(5);
  });

  it("ping responds with an empty result object (M6 fix)", async () => {
    const { startSymplekMcpServer } = await import("../server/index.js");

    const fakeStdin = new PassThrough();
    const chunks: string[] = [];
    const realStdout = process.stdout;
    const fakeStdout = new PassThrough();
    fakeStdout.on("data", (c: Buffer) => chunks.push(c.toString()));
    const realStdin = process.stdin;

    Object.defineProperty(process, "stdin", { value: fakeStdin, configurable: true, writable: true });
    Object.defineProperty(process, "stdout", { value: fakeStdout, configurable: true, writable: true });

    const serverPromise = startSymplekMcpServer();
    fakeStdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 7, method: "ping" })}\n`);

    await new Promise((resolve) => setTimeout(resolve, 10));
    fakeStdin.end();
    await serverPromise;

    Object.defineProperty(process, "stdin", { value: realStdin, configurable: true, writable: true });
    Object.defineProperty(process, "stdout", { value: realStdout, configurable: true, writable: true });

    const lines = chunks.join("").split("\n").filter((l) => l.trim());
    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0]) as { id: number; result: unknown };
    expect(parsed.id).toBe(7);
    // MCP spec: ping must return an empty result object, not an error.
    expect(parsed.result).toEqual({});
  });

  it("null input does not crash the server (M4 fix)", async () => {
    const { startSymplekMcpServer } = await import("../server/index.js");

    const fakeStdin = new PassThrough();
    const chunks: string[] = [];
    const realStdout = process.stdout;
    const fakeStdout = new PassThrough();
    fakeStdout.on("data", (c: Buffer) => chunks.push(c.toString()));
    const realStdin = process.stdin;

    Object.defineProperty(process, "stdin", { value: fakeStdin, configurable: true, writable: true });
    Object.defineProperty(process, "stdout", { value: fakeStdout, configurable: true, writable: true });

    const serverPromise = startSymplekMcpServer();
    // "null" is valid JSON that parses to null — the pre-fix server crashed here.
    fakeStdin.write("null\n");
    // Verify the server is still running by sending a real request.
    fakeStdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 9, method: "ping" })}\n`);

    await new Promise((resolve) => setTimeout(resolve, 20));
    fakeStdin.end();
    await serverPromise;

    Object.defineProperty(process, "stdin", { value: realStdin, configurable: true, writable: true });
    Object.defineProperty(process, "stdout", { value: realStdout, configurable: true, writable: true });

    const lines = chunks.join("").split("\n").filter((l) => l.trim());
    // Two responses: error for null, then success for ping.
    expect(lines.length).toBeGreaterThanOrEqual(2);
    // The ping must succeed (server still alive after null).
    const pingLine = lines.find((l) => {
      try { return (JSON.parse(l) as { id?: number }).id === 9; } catch { return false; }
    });
    expect(pingLine).toBeDefined();
    const ping = JSON.parse(pingLine!) as { result: unknown };
    expect(ping.result).toEqual({});
  });
});

// ─── M14: Built binary integration (dist/bin.cjs) ────────────────────────────
// M14 fix: the original suite never ran the actual built binary. This suite
// spawns dist/bin.cjs to catch packaging failures that source-level tests miss.

const DIST_BIN = resolve(__dirname, "../../dist/bin.cjs");
const binaryExists = existsSync(DIST_BIN);

describe("dist/bin.cjs integration (M14)", () => {
  it.skipIf(!binaryExists)(
    "starts, responds to initialize, and exits cleanly when stdin closes",
    async () => {
      const { spawn } = await import("node:child_process");

      const proc = spawn(process.execPath, [DIST_BIN], {
        stdio: ["pipe", "pipe", "pipe"],
      });

      const responses: string[] = [];
      let buffer = "";
      proc.stdout.on("data", (chunk: Buffer) => {
        buffer += chunk.toString();
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const l of lines) {
          if (l.trim()) responses.push(l);
        }
      });

      const stderrLines: string[] = [];
      proc.stderr.on("data", (d: Buffer) => stderrLines.push(d.toString()));

      const exitCode = new Promise<number | null>((res) =>
        proc.on("exit", res),
      );

      // Send initialize + ping
      proc.stdin.write(
        `${JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "test", version: "0" } },
        })}\n`,
      );
      proc.stdin.write(
        `${JSON.stringify({ jsonrpc: "2.0", id: 2, method: "ping" })}\n`,
      );

      await new Promise((res) => setTimeout(res, 200));
      proc.stdin.end();

      const code = await Promise.race([
        exitCode,
        new Promise<number | null>((_, rej) =>
          setTimeout(() => rej(new Error("binary did not exit in 5s")), 5000),
        ),
      ]);

      // Must exit cleanly (0 or null for SIGTERM from stdin close, not 1)
      expect(code).not.toBe(1);

      // Must have responded to initialize
      const initResponse = responses.find((r) => {
        try { return (JSON.parse(r) as { id?: number }).id === 1; } catch { return false; }
      });
      expect(initResponse).toBeDefined();
      const init = JSON.parse(initResponse!) as {
        result?: { protocolVersion?: string; serverInfo?: { name: string } };
      };
      expect(init.result?.protocolVersion).toBe("2024-11-05");
      expect(init.result?.serverInfo?.name).toBe("symplek");

      // Must have responded to ping with empty result
      const pingResponse = responses.find((r) => {
        try { return (JSON.parse(r) as { id?: number }).id === 2; } catch { return false; }
      });
      expect(pingResponse).toBeDefined();
      const ping = JSON.parse(pingResponse!) as { result: unknown };
      expect(ping.result).toEqual({});

      // No deprecation warnings in stderr
      const deprecationWarning = stderrLines.join("").includes("deprecated");
      expect(deprecationWarning).toBe(false);
    },
    10_000,
  );

  it("dist/bin.cjs file exists (binary was built before test)", () => {
    // This test intentionally fails — not skips — when the binary is missing,
    // because the binary must be built before tests. If it's missing, the
    // build step was skipped, which is a packaging error.
    expect(binaryExists, `dist/bin.cjs not found at ${DIST_BIN} — run pnpm build first`).toBe(true);
  });
});
