/**
 * @module context.test - Unit tests for createContext()
 */
import { describe, expect, it } from "vitest";
import { createContext } from "../context";

describe("createContext", () => {
  it("works zero-arg and returns timestamp", () => {
    const ctx = createContext();
    expect(ctx.timestamp).toBeDefined();
    expect(typeof ctx.timestamp).toBe("number");
  });

  it("accepts optional signal", () => {
    const controller = new AbortController();
    const ctx = createContext({ signal: controller.signal });
    expect(ctx.signal).toBe(controller.signal);
  });
});
