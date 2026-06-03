/**
 * @module providers/__tests__/ai-unknown-error-redaction - M2 regression.
 *
 * The ai() UNKNOWN_ERROR backstop previously forwarded a raw thrown error as
 * `cause: error` and copied raw `error.message`. If a provider SDK error ever
 * escapes the adapter catch blocks and reaches this backstop, the raw error
 * carries the API key in request-header objects (reachable via util.inspect /
 * .cause walkers). This test pins that the backstop now drops the secret-bearing
 * raw cause and emits only a flat, key-free summary.
 */

import { inspect } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ai } from "../../ai";
import { WeftError } from "../../errors";
import type { Provider } from "../interface";
import { providerRegistry } from "../registry";

const FAKE_KEY = "sk-proj-FAKEKEY0987654321";

/**
 * A provider whose generate() throws a raw, NON-WeftError SDK-shaped error that
 * embeds the key in its message and in a request-header object — simulating an
 * SDK failure that bypassed adapter redaction and hit the ai() backstop.
 */
function makeLeakyProvider(): Provider {
  return {
    id: "leaky-test-provider",
    name: "Leaky Test Provider",
    capabilities: {
      streaming: false,
      tools: false,
      vision: false,
      structuredOutput: false,
      maxContextTokens: 1000,
    },
    async generate() {
      const err = new Error(
        `boom for ${FAKE_KEY}`,
      ) as Error & Record<string, unknown>;
      err.headers = { authorization: `Bearer ${FAKE_KEY}` };
      err.request = { headers: { Authorization: `Bearer ${FAKE_KEY}` } };
      throw err;
    },
    async *stream() {
      throw new Error("unused");
    },
    identify() {
      return { id: "leaky-test-provider", name: "Leaky Test Provider" };
    },
  };
}

describe("ai() UNKNOWN_ERROR backstop (M2)", () => {
  let savedKey: string | undefined;

  beforeEach(() => {
    // The backstop has no explicit key reference; it relies on the env-key
    // scrub. Set the key in the env so redactEnvKeys() has the live value to
    // match — mirrors a real deployment where the key is configured via env.
    savedKey = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = FAKE_KEY;
  });

  afterEach(() => {
    if (savedKey === undefined) {
      delete process.env.OPENAI_API_KEY;
    } else {
      process.env.OPENAI_API_KEY = savedKey;
    }
    providerRegistry.clear();
  });

  it("does not forward a raw provider-SDK cause carrying the key", async () => {
    providerRegistry.register(makeLeakyProvider(), true);

    let caught: unknown;
    try {
      await ai("hello", { provider: "leaky-test-provider", model: "test-model" });
      throw new Error("expected ai() to reject");
    } catch (e) {
      caught = e;
    }

    expect(caught).toBeInstanceOf(WeftError);
    const err = caught as WeftError;
    expect(err.code).toBe("UNKNOWN_ERROR");

    // The raw header/request objects must NOT be retained on the cause.
    const cause = err.cause as Record<string, unknown> | undefined;
    expect(cause).toBeDefined();
    expect(cause).not.toHaveProperty("headers");
    expect(cause).not.toHaveProperty("request");

    // util.inspect walks .cause — the previous code leaked the key here.
    const dump = inspect(err, { depth: 10 });
    expect(dump).not.toContain(FAKE_KEY);
    expect(JSON.stringify(err.toJSON())).not.toContain(FAKE_KEY);
  });
});
