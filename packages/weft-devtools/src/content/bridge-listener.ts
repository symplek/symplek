import type { BridgeMessage, DevToolsMessage } from "../bridge/types";

/**
 * Content-script listener that bridges messages from the host page to the
 * extension's background script.
 *
 * Hardening:
 *   - Same-frame only: rejects messages whose `event.source` isn't this
 *     window (so other frames can't spoof traces).
 *   - Origin gate: by default, only `http://localhost:*` and the dev
 *     subdomains we recognise can talk to the extension. Production sites
 *     have to call `window.weftDevTools.enable()` (added in a follow-up)
 *     to opt in — the bridge ignores them otherwise.
 *   - Strict type check: rejects messages that don't match the BridgeMessage
 *     shape exactly, including the discriminator and known `type` values.
 *   - Size cap: payloads larger than MAX_PAYLOAD_BYTES are dropped with a
 *     console warning. Protects the extension from runaway memory and
 *     traces that would freeze the DevTools panel.
 */

/** 256 KB — generous for a trace, tight enough to refuse abuse. */
const MAX_PAYLOAD_BYTES = 256 * 1024;

/** Origins allowed by default. Production sites require an explicit opt-in handshake (see README). */
const ALLOWED_ORIGIN_RE =
  /^https?:\/\/(localhost(:\d+)?|127\.0\.0\.1(:\d+)?|.*\.vercel\.app|.*\.netlify\.app|.*\.fly\.dev)$/;

const KNOWN_TYPES: ReadonlySet<DevToolsMessage["type"]> = new Set([
  "Weft_EXECUTION_START",
  "Weft_EXECUTION_STEP",
  "Weft_EXECUTION_COMPLETE",
  "Weft_THINKING",
  "Weft_METRICS",
]);

function isBridgeMessage(value: unknown): value is BridgeMessage {
  if (value === null || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  if (v.source !== "Weft-page") return false;
  if (typeof v.type !== "string") return false;
  if (!KNOWN_TYPES.has(v.type as DevToolsMessage["type"])) return false;
  if (v.payload === undefined || v.payload === null) return false;
  return true;
}

function isOriginAllowed(origin: string): boolean {
  // `null` origin (file://, sandboxed iframes) is never allowed.
  if (!origin || origin === "null") return false;
  return ALLOWED_ORIGIN_RE.test(origin);
}

/**
 * Initialise the content-script listener that bridges messages from the
 * host page to the extension's background script.
 */
export function initBridgeListener(): void {
  window.addEventListener("message", (event) => {
    // Same-frame only.
    if (event.source !== window) return;

    // Origin gate.
    if (!isOriginAllowed(event.origin)) return;

    const raw = event.data;

    // Strict shape check before we touch anything else.
    if (!isBridgeMessage(raw)) return;

    // Size cap. Serialise once; if it's too big, drop and warn.
    let serialised: string;
    try {
      serialised = JSON.stringify(raw);
    } catch {
      // Cyclic / non-serialisable payload — drop silently.
      return;
    }
    if (serialised.length > MAX_PAYLOAD_BYTES) {
      console.warn(
        `[Weft DevTools] dropping ${raw.type} payload ${serialised.length} bytes (> ${MAX_PAYLOAD_BYTES})`,
      );
      return;
    }

    try {
      chrome.runtime.sendMessage(raw);
    } catch (error) {
      console.error(
        "[Weft DevTools] Failed to send message to background:",
        error,
      );
    }
  });
}
