/**
 * @fileoverview Error Integration Tests for AgentUnit
 * @description Tests for Story 01.03: AgentUnit Error Integration
 * @module @symplek/core/__tests__/error-integration
 * @since 1.0.0-beta.1
 *
 * 📝 BUILD[01.03]: Error integration tests
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentUnit } from "../AgentUnit";
import type { SymplekErrorDetail } from "../errors";
import type { AgentContext } from "../types";

// Test context
const createTestContext = (): AgentContext => ({
  timestamp: Date.now(),
});

describe("AgentUnit Error Integration (Story 01.03)", () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // Spy on console.error to capture error output
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  describe("Error Detection", () => {
    it("detects timeout errors (E201)", async () => {
      const unit = AgentUnit.from<string>(async () => {
        throw new Error("Operation timed out after 30000ms");
      });

      const ctx = createTestContext();

      await expect(unit.run(ctx)).rejects.toMatchObject({
        SymplekError: expect.objectContaining({
          code: "E201",
        }),
      });

      expect(consoleErrorSpy).toHaveBeenCalled();
      const output = consoleErrorSpy.mock.calls[0][0];
      expect(output).toContain("[E201]");
      expect(output).toContain("Execution Error");
    });

    it("detects rate limit errors (E203)", async () => {
      const unit = AgentUnit.from<string>(async () => {
        throw new Error("Rate limit exceeded: too many requests");
      });

      const ctx = createTestContext();

      await expect(unit.run(ctx)).rejects.toMatchObject({
        SymplekError: expect.objectContaining({
          code: "E203",
        }),
      });

      const output = consoleErrorSpy.mock.calls[0][0];
      expect(output).toContain("[E203]");
      expect(output).toContain(".retry(");
    });

    it("detects low confidence errors (E202)", async () => {
      const unit = AgentUnit.from<string>(async () => {
        throw new Error("Confidence below threshold: 0.4 < 0.8");
      });

      const ctx = createTestContext();

      await expect(unit.run(ctx)).rejects.toMatchObject({
        SymplekError: expect.objectContaining({
          code: "E202",
        }),
      });
    });

    it("detects injection errors (E401)", async () => {
      const unit = AgentUnit.from<string>(async () => {
        throw new Error("Injection detected in user input");
      });

      const ctx = createTestContext();

      await expect(unit.run(ctx)).rejects.toMatchObject({
        SymplekError: expect.objectContaining({
          code: "E401",
        }),
      });

      const output = consoleErrorSpy.mock.calls[0][0];
      expect(output).toContain("Security Error");
      expect(output).toContain(".scanned(");
    });

    it("detects consensus deadlock errors (E301)", async () => {
      const unit = AgentUnit.from<string>(async () => {
        throw new Error("Consensus deadlock: no agreement after 5 rounds");
      });

      const ctx = createTestContext();

      await expect(unit.run(ctx)).rejects.toMatchObject({
        SymplekError: expect.objectContaining({
          code: "E301",
        }),
      });

      const output = consoleErrorSpy.mock.calls[0][0];
      expect(output).toContain("Coordination Error");
      expect(output).toContain("quorum");
    });

    it("detects missing context errors (E101)", async () => {
      const unit = AgentUnit.from<string>(async () => {
        throw new Error("Missing context: userId is required");
      });

      const ctx = createTestContext();

      await expect(unit.run(ctx)).rejects.toMatchObject({
        SymplekError: expect.objectContaining({
          code: "E101",
        }),
      });

      const output = consoleErrorSpy.mock.calls[0][0];
      expect(output).toContain("Context Error");
      expect(output).toContain("buildContext");
    });

    it("falls back to E000 for unknown errors", async () => {
      const unit = AgentUnit.from<string>(async () => {
        throw new Error("Something completely unexpected happened");
      });

      const ctx = createTestContext();

      await expect(unit.run(ctx)).rejects.toMatchObject({
        SymplekError: expect.objectContaining({
          code: "E000",
        }),
      });
    });
  });

  describe("Error Enhancement", () => {
    it("attaches SymplekError property to thrown error", async () => {
      const unit = AgentUnit.from<string>(async () => {
        throw new Error("Timeout error");
      });

      const ctx = createTestContext();

      try {
        await unit.run(ctx);
        expect.fail("Should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
        expect(
          (error as Error & { SymplekError: SymplekErrorDetail }).SymplekError,
        ).toBeDefined();

        const SymplekError = (error as Error & { SymplekError: SymplekErrorDetail })
          .SymplekError;
        expect(SymplekError.code).toBe("E201");
        expect(SymplekError.message).toContain("[E201]");
        expect(SymplekError.fix).toBeDefined();
        expect(SymplekError.fix.docsUrl).toContain("symplek.com");
        expect(SymplekError.originalMessage).toBe("Timeout error");
        expect(SymplekError.timestamp).toBeGreaterThan(0);
      }
    });

    it("preserves original error stack trace", async () => {
      const originalError = new Error("Original error message");
      const originalStack = originalError.stack;

      const unit = AgentUnit.from<string>(async () => {
        throw originalError;
      });

      const ctx = createTestContext();

      try {
        await unit.run(ctx);
        expect.fail("Should have thrown");
      } catch (error) {
        expect(error).toBe(originalError);
        expect((error as Error).stack).toBe(originalStack);
      }
    });

    it("includes operator chain in error location", async () => {
      const unit = AgentUnit.of(42)
        .map((x) => x * 2)
        .flatMap((_x) =>
          AgentUnit.from<number>(async () => {
            throw new Error("Failed during chain");
          }),
        );

      const ctx = createTestContext();

      try {
        await unit.run(ctx);
        expect.fail("Should have thrown");
      } catch (error) {
        const SymplekError = (error as Error & { SymplekError: SymplekErrorDetail })
          .SymplekError;
        expect(SymplekError.location?.operatorChain).toBeDefined();
        expect(SymplekError.location?.operatorChain).toContain("flatMap");
      }
    });
  });

  describe("Console Output", () => {
    it("logs formatted error to console", async () => {
      const unit = AgentUnit.from<string>(async () => {
        throw new Error("Rate limit exceeded");
      });

      const ctx = createTestContext();

      try {
        await unit.run(ctx);
      } catch {
        // Expected
      }

      expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
      const output = consoleErrorSpy.mock.calls[0][0];

      // Check for error code
      expect(output).toContain("[E203]");

      // Check for fix suggestion
      expect(output).toContain("Fix:");

      // Check for docs link
      expect(output).toContain("Docs:");
      expect(output).toContain("symplek.com");
    });

    it("includes code snippet in output when available", async () => {
      const unit = AgentUnit.from<string>(async () => {
        throw new Error("Operation timed out");
      });

      const ctx = createTestContext();

      try {
        await unit.run(ctx);
      } catch {
        // Expected
      }

      const output = consoleErrorSpy.mock.calls[0][0];
      expect(output).toContain(".timeout("); // Code snippet for timeout fix
    });
  });

  describe("Legacy Mode Error Handling", () => {
    it("enhances errors in legacy mode too", async () => {
      const unit = AgentUnit.from<string>(async () => {
        throw new Error("Timeout error");
      });

      const ctx = createTestContext();

      await expect(
        unit.run(ctx, { trustMode: "legacy" }),
      ).rejects.toMatchObject({
        SymplekError: expect.objectContaining({
          code: "E201",
        }),
      });
    });
  });

  describe("Non-Error Object Handling", () => {
    it("wraps non-Error throws in Error object", async () => {
      const unit = AgentUnit.from<string>(async () => {
        // eslint-disable-next-line @typescript-eslint/only-throw-error
        throw "String error message";
      });

      const ctx = createTestContext();

      try {
        await unit.run(ctx);
        expect.fail("Should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).toBe("String error message");
        expect(
          (error as Error & { SymplekError: SymplekErrorDetail }).SymplekError,
        ).toBeDefined();
      }
    });
  });

  describe("Specific Error Pattern Tests", () => {
    const errorPatternTests: Array<{ pattern: string; expectedCode: string }> =
      [
        { pattern: "timeout after 30s", expectedCode: "E201" },
        { pattern: "timed out waiting for response", expectedCode: "E201" },
        { pattern: "exceeded timeout threshold", expectedCode: "E201" },
        { pattern: "rate limit hit", expectedCode: "E203" },
        { pattern: "too many requests per minute", expectedCode: "E203" },
        { pattern: "HTTP 429 error", expectedCode: "E203" },
        { pattern: "confidence is below minimum", expectedCode: "E202" },
        { pattern: "low confidence score detected", expectedCode: "E202" },
        { pattern: "tool execution failed", expectedCode: "E204" },
        { pattern: "max steps reached", expectedCode: "E205" },
        { pattern: "step limit exceeded", expectedCode: "E205" },
        { pattern: "consensus deadlock detected", expectedCode: "E301" },
        { pattern: "no agreement reached", expectedCode: "E301" },
        { pattern: "challenge failed on thesis", expectedCode: "E302" },
        { pattern: "circular dependency in agents", expectedCode: "E303" },
        { pattern: "possible injection attack", expectedCode: "E401" },
        { pattern: "malicious content detected", expectedCode: "E401" },
        { pattern: "untrusted source", expectedCode: "E402" },
        { pattern: "spoofed result detected", expectedCode: "E403" },
        { pattern: "missing required context", expectedCode: "E101" },
        { pattern: "context is required", expectedCode: "E101" },
        { pattern: "invalid context structure", expectedCode: "E102" },
        { pattern: "context has expired", expectedCode: "E103" },
        { pattern: "permission denied", expectedCode: "E104" },
        { pattern: "type mismatch found", expectedCode: "E001" },
        { pattern: "missing required field", expectedCode: "E002" },
        { pattern: "schema validation failed", expectedCode: "E004" },
        { pattern: "cannot read property of null", expectedCode: "E005" },
      ];

    it.each(errorPatternTests)('detects "$pattern" as $expectedCode', async ({
      pattern,
      expectedCode,
    }) => {
      const unit = AgentUnit.from<string>(async () => {
        throw new Error(pattern);
      });

      const ctx = createTestContext();

      try {
        await unit.run(ctx);
        expect.fail("Should have thrown");
      } catch (error) {
        const SymplekError = (error as Error & { SymplekError: SymplekErrorDetail })
          .SymplekError;
        expect(SymplekError.code).toBe(expectedCode);
      }
    });
  });
});
