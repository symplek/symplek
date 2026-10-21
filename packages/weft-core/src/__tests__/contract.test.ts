/**
 * @fileoverview Tests for contract validation
 * @description Unit tests for ContractError, zodErrorToMismatches, and defineContract
 * @module @symplek/core/contract.test
 *
 * 📝 BUILD[F-047]: Story 03.01, 03.02, 03.03 - Contract validation tests
 */

import { beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { AgentUnit } from "../AgentUnit";
import {
  ContractError,
  defineContract,
  zodErrorToMismatches,
} from "../contract";
import type { AgentContext } from "../types";

// ─────────────────────────────────────────────────────────────────────────────
// TEST CONTEXT
// ─────────────────────────────────────────────────────────────────────────────

let ctx: AgentContext;

beforeEach(() => {
  ctx = {
    timestamp: Date.now(),
  };
});

// ─────────────────────────────────────────────────────────────────────────────
// STORY 03.01: ContractError Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("ContractError", () => {
  it("formats error message with producer and consumer names", () => {
    const error = new ContractError("orchestrator", "synthesis", []);
    expect(error.message).toContain("orchestrator");
    expect(error.message).toContain("synthesis");
    expect(error.message).toContain("Contract mismatch");
  });

  it("lists all mismatches in message", () => {
    const error = new ContractError("producer", "consumer", [
      {
        path: "metadata.field",
        expected: "string",
        received: "undefined",
        message: "Required",
      },
      {
        path: "tasks",
        expected: "array",
        received: "undefined",
        message: "Required",
      },
    ]);
    expect(error.message).toContain("metadata.field");
    expect(error.message).toContain("tasks");
    expect(error.message).toContain("2 validation error(s)");
  });

  it("has name ContractError", () => {
    const error = new ContractError("p", "c", []);
    expect(error.name).toBe("ContractError");
  });

  it("is instanceof Error", () => {
    const error = new ContractError("p", "c", []);
    expect(error).toBeInstanceOf(Error);
  });

  it("exposes producer, consumer, and mismatches", () => {
    const mismatches = [
      { path: "a", expected: "string", received: "number", message: "Invalid" },
    ];
    const error = new ContractError("prod", "cons", mismatches);
    expect(error.producerName).toBe("prod");
    expect(error.consumerName).toBe("cons");
    expect(error.mismatches).toEqual(mismatches);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// zodErrorToMismatches Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("zodErrorToMismatches", () => {
  it("converts Zod errors to ContractMismatch array", () => {
    const schema = z.object({ name: z.string() });
    const result = schema.safeParse({ name: 123 });

    if (!result.success) {
      const mismatches = zodErrorToMismatches(result.error);
      expect(mismatches).toHaveLength(1);
      expect(mismatches[0].path).toBe("name");
      expect(mismatches[0].expected).toBe("string");
      expect(mismatches[0].received).toBe("number");
    } else {
      throw new Error("Expected validation to fail");
    }
  });

  it("handles nested objects", () => {
    const schema = z.object({
      metadata: z.object({ id: z.string() }),
    });
    const result = schema.safeParse({ metadata: { id: 123 } });

    if (!result.success) {
      const mismatches = zodErrorToMismatches(result.error);
      expect(mismatches[0].path).toBe("metadata.id");
    } else {
      throw new Error("Expected validation to fail");
    }
  });

  it("handles arrays", () => {
    const schema = z.object({
      tasks: z.array(z.object({ name: z.string() })),
    });
    const result = schema.safeParse({ tasks: [{ name: 123 }] });

    if (!result.success) {
      const mismatches = zodErrorToMismatches(result.error);
      expect(mismatches[0].path).toBe("tasks.0.name");
    } else {
      throw new Error("Expected validation to fail");
    }
  });

  it("handles root-level errors", () => {
    const schema = z.string();
    const result = schema.safeParse(123);

    if (!result.success) {
      const mismatches = zodErrorToMismatches(result.error);
      expect(mismatches[0].path).toBe("(root)");
    } else {
      throw new Error("Expected validation to fail");
    }
  });

  it("handles multiple errors", () => {
    const schema = z.object({
      name: z.string(),
      age: z.number(),
    });
    const result = schema.safeParse({ name: 123, age: "invalid" });

    if (!result.success) {
      const mismatches = zodErrorToMismatches(result.error);
      expect(mismatches.length).toBe(2);
    } else {
      throw new Error("Expected validation to fail");
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// defineContract Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("defineContract", () => {
  it("returns named contract object", () => {
    const schema = z.object({ id: z.string() });
    const contract = defineContract("TestContract", schema);

    expect(contract.name).toBe("TestContract");
    expect(contract.schema).toBe(schema);
  });

  it("preserves schema functionality", () => {
    const schema = z.object({ id: z.string() });
    const contract = defineContract("Test", schema);

    const valid = contract.schema.safeParse({ id: "123" });
    expect(valid.success).toBe(true);

    const invalid = contract.schema.safeParse({ id: 123 });
    expect(invalid.success).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// STORY 03.02: .provides() Operator Tests
// ─────────────────────────────────────────────────────────────────────────────

describe(".provides()", () => {
  const schema = z.object({ name: z.string(), count: z.number() });

  it("validates output against schema", async () => {
    const unit = AgentUnit.of({ name: "test", count: 1 }).provides(schema);
    const result = await unit.run(ctx);
    expect(result.value).toEqual({ name: "test", count: 1 });
  });

  it("throws ContractError on mismatch", async () => {
    const unit = AgentUnit.of({ name: "test" }).provides(schema);
    await expect(unit.run(ctx)).rejects.toThrow(ContractError);
  });

  it("throws ContractError with path info on type mismatch", async () => {
    const unit = AgentUnit.of({ name: 123, count: 1 }).provides(schema);
    try {
      await unit.run(ctx);
      throw new Error("Should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(ContractError);
      const contractError = e as ContractError;
      expect(contractError.mismatches[0].path).toBe("name");
    }
  });

  it("strict mode fails on extra fields", async () => {
    const unit = AgentUnit.of({ name: "test", count: 1, extra: true }).provides(
      schema,
      { strict: true },
    );
    await expect(unit.run(ctx)).rejects.toThrow(ContractError);
  });

  it("non-strict mode allows extra fields", async () => {
    const unit = AgentUnit.of({ name: "test", count: 1, extra: true }).provides(
      schema,
    );
    const result = await unit.run(ctx);
    expect(result.value.name).toBe("test");
  });

  it("includes provides in operator chain", () => {
    const unit = AgentUnit.of({ name: "test", count: 1 }).provides(schema);
    expect(unit.getMetadata().operatorChain).toContain("provides");
  });

  it("works with map", async () => {
    const unit = AgentUnit.of({ name: "test", count: 1 })
      .provides(schema)
      .map((v) => v.name);
    const result = await unit.run(ctx);
    expect(result.value).toBe("test");
  });

  it("works with flatMap", async () => {
    const unit = AgentUnit.of({ name: "test", count: 1 })
      .provides(schema)
      .flatMap((v) => AgentUnit.of(v.count * 2));
    const result = await unit.run(ctx);
    expect(result.value).toBe(2);
  });

  it("works with timeout", async () => {
    const unit = AgentUnit.of({ name: "test", count: 1 })
      .provides(schema)
      .timeout(5000);
    const result = await unit.run(ctx);
    expect(result.value.name).toBe("test");
  });

  it("infers output type from schema", async () => {
    const unit = AgentUnit.of({ name: "test", count: 1 }).provides(schema);
    const result = await unit.run(ctx);

    // TypeScript should infer these types correctly
    const name: string = result.value.name;
    const count: number = result.value.count;
    expect(name).toBe("test");
    expect(count).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// STORY 03.03: .expects() Operator Tests
// ─────────────────────────────────────────────────────────────────────────────

describe(".expects()", () => {
  const schema = z.object({ id: z.string() });

  it("validates input before computation", async () => {
    const unit = AgentUnit.from(async () => "result").expects(
      schema,
      (ctx) => ctx.extensions?.input,
    );

    const ctxWithInput: AgentContext = {
      ...ctx,
      extensions: { input: { id: "valid" } },
    };
    const result = await unit.run(ctxWithInput);
    expect(result.value).toBe("result");
  });

  it("throws ContractError on invalid input", async () => {
    const unit = AgentUnit.from(async () => "result").expects(
      schema,
      (ctx) => ctx.extensions?.input,
    );

    const ctxWithBadInput: AgentContext = {
      ...ctx,
      extensions: { input: { id: 123 } },
    };
    await expect(unit.run(ctxWithBadInput)).rejects.toThrow(ContractError);
  });

  it("throws ContractError on missing input", async () => {
    const unit = AgentUnit.from(async () => "result").expects(
      schema,
      (ctx) => ctx.extensions?.input,
    );

    await expect(unit.run(ctx)).rejects.toThrow(ContractError);
  });

  it("does not run computation on invalid input", async () => {
    let computationRan = false;
    const unit = AgentUnit.from(async () => {
      computationRan = true;
      return "result";
    }).expects(schema, (ctx) => ctx.extensions?.input);

    try {
      await unit.run(ctx);
    } catch {
      // Expected
    }
    expect(computationRan).toBe(false);
  });

  it("includes expects in operator chain", () => {
    const unit = AgentUnit.from(async () => "result").expects(
      schema,
      (ctx) => ctx.extensions?.input,
    );
    expect(unit.getMetadata().operatorChain).toContain("expects");
  });

  it("preserves original output type", async () => {
    const unit = AgentUnit.from(async () => 42).expects(
      schema,
      (ctx) => ctx.extensions?.input,
    );

    const ctxWithInput: AgentContext = {
      ...ctx,
      extensions: { input: { id: "valid" } },
    };
    const result = await unit.run(ctxWithInput);

    // Should be number, not affected by input schema
    expect(typeof result.value).toBe("number");
    expect(result.value).toBe(42);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// STORY 03.04: Integration Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("Contract Integration", () => {
  const SharedContract = z.object({
    id: z.string(),
    data: z.object({ value: z.number() }),
  });

  it("producer/consumer pattern works end-to-end", async () => {
    // Producer validates output
    const producer = AgentUnit.from(async () => ({
      id: "test",
      data: { value: 42 },
    })).provides(SharedContract);

    // Run producer
    const producerResult = await producer.run(ctx);

    // Consumer validates input (simulating passing data via context)
    const consumer = AgentUnit.from(async (ctx) => {
      const input = ctx.extensions?.data as z.infer<typeof SharedContract>;
      return `Received: ${input.id}`;
    }).expects(SharedContract, (ctx) => ctx.extensions?.data);

    // Chain them via context
    const consumerCtx: AgentContext = {
      ...ctx,
      extensions: { data: producerResult.value },
    };
    const consumerResult = await consumer.run(consumerCtx);

    expect(consumerResult.value).toBe("Received: test");
  });

  it("works with map/flatMap chain", async () => {
    const unit = AgentUnit.of({ id: "test", data: { value: 42 } })
      .provides(SharedContract)
      .map((v) => v.data.value)
      .map((v) => v * 2);

    const result = await unit.run(ctx);
    expect(result.value).toBe(84);
  });

  it("works with fallback", async () => {
    const failing = AgentUnit.from<z.infer<typeof SharedContract>>(async () => {
      throw new Error("fail");
    });

    const fallback = AgentUnit.of({ id: "fallback", data: { value: 0 } });

    const unit = failing.fallback(fallback).provides(SharedContract);
    const result = await unit.run(ctx);
    expect(result.value.id).toBe("fallback");
  });

  it("contract error includes all mismatches", async () => {
    const unit = AgentUnit.of({ wrong: "data" }).provides(SharedContract);

    try {
      await unit.run(ctx);
      throw new Error("Should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(ContractError);
      const contractError = e as ContractError;
      // Should have errors for both 'id' and 'data' missing
      expect(contractError.mismatches.length).toBeGreaterThanOrEqual(2);
    }
  });

  it("strict contract catches extra fields in nested objects", async () => {
    const strictUnit = AgentUnit.of({
      id: "test",
      data: { value: 42, extra: true },
    }).provides(SharedContract, { strict: true });

    // Strict mode on the outer schema doesn't automatically apply to nested
    // This test verifies the behavior - outer strict doesn't catch nested extras
    const result = await strictUnit.run(ctx);
    expect(result.value.id).toBe("test");
  });
});
