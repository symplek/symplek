/**
 * @module providers/__tests__/redact - Regression tests for secret redaction.
 *
 * Covers the release-hardening findings H2/M1 (provider key leak via message +
 * retained SDK cause), M2 (ai.ts UNKNOWN_ERROR backstop), and M5 (sanitizeContext
 * cycle DoS + array-nested secret). Each test pins one acceptance criterion so a
 * future regression that re-leaks the key fails loudly.
 */

import { inspect } from "node:util";
import { describe, expect, it } from "vitest";
import { WeftError } from "../../errors";
import { redactErrorMessage, redactKey, safeCause } from "../redact";

const FAKE_KEY = "sk-ant-FAKEKEY1234567890";

describe("redactKey", () => {
  it("redacts EVERY occurrence of the key (not just the first)", () => {
    const input = `auth ${FAKE_KEY} then again ${FAKE_KEY} end`;
    const out = redactKey(FAKE_KEY, input);
    expect(out).not.toContain(FAKE_KEY);
    expect(out.match(/\[REDACTED\]/g)).toHaveLength(2);
  });

  it("is a no-op when the key is falsy", () => {
    expect(redactKey(undefined, "hello")).toBe("hello");
    expect(redactKey("", "hello")).toBe("hello");
  });

  it("coerces non-string input to a string before scrubbing", () => {
    expect(redactKey(FAKE_KEY, null)).toBe("");
    expect(redactKey(FAKE_KEY, 42)).toBe("42");
  });
});

describe("redactErrorMessage", () => {
  it("scrubs the key from an Error's message", () => {
    const err = new Error(`request failed for ${FAKE_KEY}`);
    const out = redactErrorMessage(FAKE_KEY, err);
    expect(out).not.toContain(FAKE_KEY);
    expect(out).toContain("[REDACTED]");
  });

  it("redacts BOTH copies when the key appears twice in the message", () => {
    const err = new Error(`key=${FAKE_KEY} url=https://x/${FAKE_KEY}`);
    const out = redactErrorMessage(FAKE_KEY, err);
    expect(out).not.toContain(FAKE_KEY);
    expect(out.match(/\[REDACTED\]/g)).toHaveLength(2);
  });
});

describe("safeCause", () => {
  /**
   * Simulates a provider SDK error that embeds the key in request headers — the
   * exact shape (Authorization: Bearer …) that leaks via util.inspect/.cause.
   */
  function makeSdkError(): Error & Record<string, unknown> {
    const err = new Error(
      `401 Unauthorized for key ${FAKE_KEY}`,
    ) as Error & Record<string, unknown>;
    err.status = 401;
    err.headers = { authorization: `Bearer ${FAKE_KEY}` };
    err.request = { headers: { Authorization: `Bearer ${FAKE_KEY}` } };
    return err;
  }

  it("DROPS the raw SDK error — no header/request objects retained", () => {
    const cause = safeCause(FAKE_KEY, makeSdkError());
    expect(cause).not.toHaveProperty("headers");
    expect(cause).not.toHaveProperty("request");
    expect(cause.redacted).toBe(true);
  });

  it("does not leak the key through the retained message or status", () => {
    const cause = safeCause(FAKE_KEY, makeSdkError());
    const serialized = JSON.stringify(cause);
    expect(serialized).not.toContain(FAKE_KEY);
    expect(cause.status).toBe(401);
  });

  it("the resulting WeftError does not leak the key via util.inspect (.cause walk)", () => {
    const err = new WeftError({
      code: "PROVIDER_ERROR",
      why: `request failed: ${redactErrorMessage(FAKE_KEY, makeSdkError())}`,
      fix: { description: "x", docsUrl: "https://x" },
      cause: safeCause(FAKE_KEY, makeSdkError()),
    });

    // util.inspect with depth walks .cause — the previous code leaked here.
    const dump = inspect(err, { depth: 10 });
    expect(dump).not.toContain(FAKE_KEY);

    // console.error stringification path is also clean.
    expect(`${err}`).not.toContain(FAKE_KEY);
  });
});

describe("sanitizeContext (M5)", () => {
  it("does NOT stack-overflow on a circular object", () => {
    const a: Record<string, any> = { name: "root" };
    a.self = a; // cycle
    a.nested = { back: a }; // deeper cycle

    let result: Record<string, any> | undefined;
    expect(() => {
      result = WeftError.sanitizeContext(a);
    }).not.toThrow();
    expect(result?.name).toBe("root");
    expect(result?.self).toBe("[Circular]");
    expect(result?.nested.back).toBe("[Circular]");
  });

  it("redacts a sensitive key nested inside an array-of-objects", () => {
    // `headers` and `entries` are non-sensitive container keys, so redaction
    // must reach INTO the array elements rather than only matching at the top
    // level — this is the behavior the old (array-skipping) code missed.
    const ctx = {
      headers: [
        { name: "content-type", value: "application/json" },
        { authorization: `Bearer ${FAKE_KEY}` },
      ],
      entries: [{ secret: FAKE_KEY }],
    };

    const out = WeftError.sanitizeContext(ctx);
    const serialized = JSON.stringify(out);

    expect(serialized).not.toContain(FAKE_KEY);
    expect(out.headers[1].authorization).toBe("[REDACTED]");
    expect(out.entries[0].secret).toBe("[REDACTED]");
    // Non-sensitive sibling preserved.
    expect(out.headers[0].value).toBe("application/json");
  });

  it("redacts a key whose own name matches a sensitive substring (e.g. `tokens`)", () => {
    // Defense-in-depth: `tokens` contains the substring `token`, so the whole
    // value is redacted wholesale. This is intentional over-redaction.
    const out = WeftError.sanitizeContext({ tokens: [FAKE_KEY] });
    expect(out.tokens).toBe("[REDACTED]");
  });

  it("redacts top-level sensitive keys and recurses into plain objects", () => {
    const out = WeftError.sanitizeContext({
      api_key: FAKE_KEY,
      nested: { secret: FAKE_KEY, safe: "ok" },
      keep: 123,
    });
    expect(out.api_key).toBe("[REDACTED]");
    expect(out.nested.secret).toBe("[REDACTED]");
    expect(out.nested.safe).toBe("ok");
    expect(out.keep).toBe(123);
  });

  it("the WeftError constructor sanitizes a circular context without throwing", () => {
    const ctx: Record<string, any> = { token: FAKE_KEY };
    ctx.loop = ctx;
    const err = new WeftError({
      code: "PROVIDER_ERROR",
      why: "boom",
      context: ctx,
    });
    expect(err.context?.token).toBe("[REDACTED]");
    expect(err.context?.loop).toBe("[Circular]");
    expect(JSON.stringify(err.toJSON())).not.toContain(FAKE_KEY);
  });
});
