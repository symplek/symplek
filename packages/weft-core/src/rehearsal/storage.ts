/**
 * @fileoverview File storage for trace persistence
 * @description Save and load execution traces with compression support
 * @module @weft/core/rehearsal/storage
 * @since 1.0.0
 *
 * 📝 BUILD[03.01]: File Storage implementation
 * 📝 BUILD[03.02]: Compression support
 */

import type { ExecutionTrace } from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// NODE MODULE CACHE — resolved once, reused across all FileStorage calls
// ─────────────────────────────────────────────────────────────────────────────

let _nodeMods: Promise<{
  fs: typeof import("node:fs/promises");
  dirname: (p: string) => string;
  gzip: (buf: Buffer) => Promise<Buffer>;
  gunzip: (buf: Buffer) => Promise<Buffer>;
}>;

function nodeModules() {
  _nodeMods ??= Promise.all([
    import("node:fs/promises"),
    import("node:zlib"),
    import("node:util"),
    import("node:path"),
  ]).then(([fs, zlib, { promisify }, { dirname }]) => ({
    fs,
    dirname,
    gzip: promisify(zlib.gzip) as unknown as (buf: Buffer) => Promise<Buffer>,
    gunzip: promisify(zlib.gunzip) as unknown as (
      buf: Buffer,
    ) => Promise<Buffer>,
  }));
  return _nodeMods;
}

// ─────────────────────────────────────────────────────────────────────────────
// STORAGE CONFIGURATION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Default storage directory for traces.
 */
export const DEFAULT_STORAGE_PATH = "__traces__";

/**
 * File extensions supported for traces.
 */
export type TraceFileExtension = ".trace.json" | ".trace.json.gz";

/**
 * Storage options.
 */
export interface StorageOptions {
  /** Base directory for traces (default: __traces__) */
  basePath?: string;
  /** Whether to compress traces (default: false) */
  compress?: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// FILE STORAGE CLASS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Storage class for saving and loading execution traces.
 *
 * Supports:
 * - JSON format (.trace.json)
 * - Compressed format (.trace.json.gz) - requires zlib
 *
 * @example
 * ```typescript
 * const storage = new FileStorage({ basePath: '__traces__' });
 *
 * // Save a trace
 * const path = await storage.save(trace);
 *
 * // Load a trace
 * const loaded = await storage.load(path);
 *
 * // List all traces
 * const traces = await storage.list();
 * ```
 */
export class FileStorage {
  private readonly basePath: string;
  private readonly compress: boolean;

  constructor(options: StorageOptions = {}) {
    this.basePath = options.basePath ?? DEFAULT_STORAGE_PATH;
    this.compress = options.compress ?? false;
  }

  /**
   * Save a trace to file.
   *
   * @param trace - The trace to save
   * @param filename - Optional custom filename (without extension)
   * @returns The full path to the saved file
   */
  async save<T>(trace: ExecutionTrace<T>, filename?: string): Promise<string> {
    const name = filename ?? trace.id;
    const extension: TraceFileExtension = this.compress
      ? ".trace.json.gz"
      : ".trace.json";
    const fullPath = `${this.basePath}/${name}${extension}`;

    const content = JSON.stringify(trace, null, 2);

    if (this.compress) {
      await this.writeCompressed(fullPath, content);
    } else {
      await this.writeFile(fullPath, content);
    }

    return fullPath;
  }

  /**
   * Load a trace from file.
   *
   * @param pathOrId - Full path or trace ID
   * @returns The loaded trace
   * @throws Error if file not found or invalid format
   */
  async load<T>(pathOrId: string): Promise<ExecutionTrace<T>> {
    const fullPath = this.resolvePath(pathOrId);
    const isCompressed = fullPath.endsWith(".gz");

    let content: string;
    if (isCompressed) {
      content = await this.readCompressed(fullPath);
    } else {
      content = await this.readFile(fullPath);
    }

    try {
      return JSON.parse(content) as ExecutionTrace<T>;
    } catch (error) {
      throw new Error(`Failed to parse trace file ${fullPath}: ${error}`);
    }
  }

  /**
   * Check if a trace exists.
   *
   * @param pathOrId - Full path or trace ID
   * @returns true if trace exists
   */
  async exists(pathOrId: string): Promise<boolean> {
    try {
      const fullPath = this.resolvePath(pathOrId);
      await this.readFile(fullPath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Delete a trace file.
   *
   * @param pathOrId - Full path or trace ID
   */
  async delete(pathOrId: string): Promise<void> {
    const fullPath = this.resolvePath(pathOrId);
    await this.deleteFile(fullPath);
  }

  /**
   * List all traces in the storage directory.
   *
   * @returns Array of trace metadata
   */
  async list(): Promise<TraceFileInfo[]> {
    const files = await this.listDirectory(this.basePath);
    const traces: TraceFileInfo[] = [];

    for (const file of files) {
      if (file.endsWith(".trace.json") || file.endsWith(".trace.json.gz")) {
        const fullPath = `${this.basePath}/${file}`;
        const stats = await this.getFileStats(fullPath);

        traces.push({
          path: fullPath,
          filename: file,
          sizeBytes: stats.size,
          createdAt: stats.createdAt,
          compressed: file.endsWith(".gz"),
        });
      }
    }

    return traces;
  }

  /**
   * Get the base storage path.
   */
  getBasePath(): string {
    return this.basePath;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // PRIVATE HELPERS (Platform-agnostic interfaces)
  // These use Node.js fs in Node, or could use other APIs in browser
  // ─────────────────────────────────────────────────────────────────────────────

  private resolvePath(pathOrId: string): string {
    // If already a full path, return as-is
    if (
      pathOrId.includes("/") ||
      pathOrId.includes("\\") ||
      pathOrId.endsWith(".json") ||
      pathOrId.endsWith(".gz")
    ) {
      return pathOrId;
    }

    // Try different extensions
    const extensions = [".trace.json", ".trace.json.gz"];
    for (const ext of extensions) {
      const _candidate = `${this.basePath}/${pathOrId}${ext}`;
      // In a real implementation, we'd check if file exists
      // For now, prefer .trace.json
    }

    return `${this.basePath}/${pathOrId}.trace.json`;
  }

  private async writeFile(filePath: string, content: string): Promise<void> {
    if (typeof globalThis !== "undefined" && "process" in globalThis) {
      const { fs, dirname } = await nodeModules();
      await fs.mkdir(dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, content, "utf-8");
    } else {
      throw new Error("FileStorage requires Node.js environment");
    }
  }

  private async readFile(filePath: string): Promise<string> {
    if (typeof globalThis !== "undefined" && "process" in globalThis) {
      const { fs } = await nodeModules();
      return await fs.readFile(filePath, "utf-8");
    }
    throw new Error("FileStorage requires Node.js environment");
  }

  private async deleteFile(filePath: string): Promise<void> {
    if (typeof globalThis !== "undefined" && "process" in globalThis) {
      const { fs } = await nodeModules();
      await fs.unlink(filePath);
    } else {
      throw new Error("FileStorage requires Node.js environment");
    }
  }

  private async writeCompressed(
    filePath: string,
    content: string,
  ): Promise<void> {
    if (typeof globalThis !== "undefined" && "process" in globalThis) {
      const { fs, dirname, gzip } = await nodeModules();
      const compressed = await gzip(Buffer.from(content, "utf-8"));
      await fs.mkdir(dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, compressed);
    } else {
      throw new Error("Compression requires Node.js environment");
    }
  }

  private async readCompressed(filePath: string): Promise<string> {
    if (typeof globalThis !== "undefined" && "process" in globalThis) {
      const { fs, gunzip } = await nodeModules();
      const compressed = await fs.readFile(filePath);
      const decompressed = await gunzip(compressed);
      return decompressed.toString("utf-8");
    }
    throw new Error("Compression requires Node.js environment");
  }

  private async listDirectory(dirPath: string): Promise<string[]> {
    if (typeof globalThis !== "undefined" && "process" in globalThis) {
      const { fs } = await nodeModules();
      try {
        return await fs.readdir(dirPath);
      } catch {
        return [];
      }
    }
    throw new Error("FileStorage requires Node.js environment");
  }

  private async getFileStats(
    filePath: string,
  ): Promise<{ size: number; createdAt: number }> {
    if (typeof globalThis !== "undefined" && "process" in globalThis) {
      const { fs } = await nodeModules();
      const stats = await fs.stat(filePath);
      return {
        size: stats.size,
        createdAt: stats.birthtimeMs,
      };
    }
    throw new Error("FileStorage requires Node.js environment");
  }
}

/**
 * Metadata about a trace file.
 */
export interface TraceFileInfo {
  path: string;
  filename: string;
  sizeBytes: number;
  createdAt: number;
  compressed: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// UTILITY FUNCTIONS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create a FileStorage instance with default options.
 *
 * @param basePath - Optional base path (default: __traces__)
 */
export function createStorage(basePath?: string): FileStorage {
  return new FileStorage({ basePath });
}

/**
 * Quick save a trace to the default location.
 *
 * @param trace - The trace to save
 * @returns The saved file path
 */
export async function saveTrace<T>(trace: ExecutionTrace<T>): Promise<string> {
  const storage = createStorage();
  return storage.save(trace);
}

/**
 * Quick load a trace from the default location.
 *
 * @param pathOrId - Full path or trace ID
 * @returns The loaded trace
 */
export async function loadTrace<T>(
  pathOrId: string,
): Promise<ExecutionTrace<T>> {
  const storage = createStorage();
  return storage.load(pathOrId);
}
