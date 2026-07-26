/**
 * @module weft-core/store/file-backend
 * @description File-based `DurableStoreBackend` reference implementation (CR-403).
 *
 *   Uses `node:fs` promises API. No external dependencies.
 *   Each KV entry is a file: `{dir}/{safe-key}` where `safe-key` is a
 *   URL-encoded form of the raw key (safe on all platforms).
 *
 *   TTL: stored as a sidecar header in the first line of the file
 *   (`X-Weft-Expires: {epoch-ms}\n`) when a TTL is provided. Reads check
 *   this header and treat expired entries as absent.
 *
 *   This implementation is suitable for single-process use (no file locking).
 *   For concurrent access or production durability, use a backend adapter from
 *   a downstream package (weft-convex, weft-redis, etc.).
 *
 * @since 2.2.0 — CR-403
 * @runtime node
 * @surface public
 */

import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { DurableStoreBackend } from "./backend";

const EXPIRES_HEADER = "X-Weft-Expires:";

/**
 * Encode an idempotency key to a filesystem-safe filename.
 *
 * Uses `~` as the percent-replacement character. Any literal `~` in the key
 * is pre-escaped to `~7E` so it cannot be confused with an encoded byte.
 * The resulting mapping is injective: no two distinct keys share a filename.
 *
 * Old `_`-based encoding was NOT injective — `"idem:run/step"` and
 * `"idem:run_2Fstep"` both produced `"idem_3Arun_2Fstep"` because
 * `encodeURIComponent` does not encode `_`. The `~` scheme avoids this
 * because `encodeURIComponent` DOES encode `~` when it appears in the key
 * (via the pre-escape step), so no literal `~` can reach the substitution
 * step and collide with a `%`-derived `~`.
 */
function encodeBody(key: string): string {
  return encodeURIComponent(key.replace(/~/g, "~7E")).replace(/%/g, "~");
}

/** Length of the disambiguating suffix, including its leading separator. */
const KEY_SUFFIX_LEN = 13; // "." + 12 hex chars

/**
 * Encode an idempotency key to a filename that is unique *as a file*, not
 * merely as a string.
 *
 * `encodeBody` alone is injective over strings but not over filenames: the
 * default filesystems on Windows and macOS are case-insensitive, so the
 * distinct keys `"OrderA"` and `"ordera"` resolve to the same file. A
 * committed entry for one would then be served as a cache hit for the other
 * and its side effect skipped — a data-correctness failure on the majority of
 * developer machines, and the reason a case-preserving encoding is not enough.
 *
 * A short digest of the exact key is appended, so keys differing only by case
 * differ in the suffix too. The readable body is kept first so directory
 * listings stay debuggable and `list(prefix)` can still match on the encoded
 * body alone. The suffix is fixed-length, so decoding slices it off rather
 * than searching for a delimiter that could occur in the body.
 */
function encodeKey(key: string): string {
  const digest = createHash("sha256").update(key, "utf8").digest("hex");
  return `${encodeBody(key)}.${digest.slice(0, 12)}`;
}

/** Decode a filename produced by {@link encodeKey} back to the original key. */
function decodeKey(encoded: string): string {
  const body = encoded.slice(0, -KEY_SUFFIX_LEN);
  return decodeURIComponent(body.replace(/~/g, "%"));
}

/**
 * Create a file-backed `DurableStoreBackend` that stores entries under `dir`.
 *
 * The directory is created lazily on first write. Reads against an absent key
 * or absent directory (ENOENT) return `null`. Any other read error (EACCES,
 * EIO, EISDIR, …) is rethrown — returning null would silently authorise
 * re-execution of a committed side effect (e.g. a payment charge).
 *
 * @example
 * ```typescript
 * import { createFileBackend, createDurableStore } from "weft-core/store";
 *
 * const store = createDurableStore(createFileBackend("./.weft-journal"));
 * ```
 */
export function createFileBackend(dir: string): DurableStoreBackend {
  /** Ensure the directory exists before writing. */
  async function ensureDir(): Promise<void> {
    await mkdir(dir, { recursive: true });
  }

  function filePath(key: string): string {
    return join(dir, encodeKey(key));
  }

  return {
    async get(key: string): Promise<Uint8Array | null> {
      const path = filePath(key);
      let raw: Buffer;
      try {
        raw = await readFile(path);
      } catch (err) {
        // ENOENT = file does not exist → the key is genuinely absent.
        // Any other error (EACCES, EIO, EISDIR, …) means the file exists or
        // could not be accessed for a reason unrelated to absence. Returning
        // null would silently authorise re-execution of a committed side
        // effect. Rethrow so the caller can surface the failure and decide
        // whether re-execution is safe after manual inspection.
        if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw err;
      }

      // Check TTL header
      const headerEnd = raw.indexOf(0x0a); // newline
      if (headerEnd > 0) {
        const firstLine = raw.slice(0, headerEnd).toString("utf8");
        if (firstLine.startsWith(EXPIRES_HEADER)) {
          const expiresAt = Number(firstLine.slice(EXPIRES_HEADER.length).trim());
          if (!Number.isNaN(expiresAt) && Date.now() >= expiresAt) {
            // Expired — delete and treat as absent
            await unlink(path).catch(() => {});
            return null;
          }
          return new Uint8Array(raw.buffer, headerEnd + 1);
        }
      }
      return new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength);
    },

    async set(key: string, value: Uint8Array, ttl?: number): Promise<void> {
      await ensureDir();
      const path = filePath(key);
      if (ttl !== undefined && ttl > 0) {
        const expiresAt = Date.now() + ttl;
        const header = `${EXPIRES_HEADER}${expiresAt}\n`;
        const headerBytes = Buffer.from(header, "utf8");
        const combined = Buffer.concat([headerBytes, Buffer.from(value)]);
        await writeFile(path, combined);
      } else {
        await writeFile(path, Buffer.from(value));
      }
    },

    async del(key: string): Promise<void> {
      await unlink(filePath(key)).catch(() => {});
    },

    async list(prefix: string): Promise<string[]> {
      let files: string[];
      try {
        files = await readdir(dir);
      } catch {
        return [];
      }
      // Match on the encoded BODY, not the full encoded name: encodeKey appends
      // a digest of the whole key, and a prefix's digest is unrelated to a full
      // key's digest, so comparing complete encodings would match nothing.
      const encodedPrefix = encodeBody(prefix);
      return files
        .filter((f) => f.startsWith(encodedPrefix))
        .map(decodeKey)
        .filter((k) => k.startsWith(prefix))
        .sort();
    },
  };
}
