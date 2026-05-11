/**
 * @fileoverview Unit tests for Trace Storage
 * @module weft-core/rehearsal/__tests__/storage
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createStorage,
  DEFAULT_STORAGE_PATH,
  FileStorage,
  loadTrace,
  saveTrace,
} from "../storage";
import type { ExecutionTrace } from "../types";
import { TRACE_SCHEMA_VERSION } from "../types";

// Mock fs module
const mockMkdir = vi.fn().mockResolvedValue(undefined);
const mockWriteFile = vi.fn().mockResolvedValue(undefined);
const mockReadFile = vi.fn().mockResolvedValue("{}");
const mockUnlink = vi.fn().mockResolvedValue(undefined);
const mockReaddir = vi.fn().mockResolvedValue([]);
const mockStat = vi
  .fn()
  .mockResolvedValue({ size: 1000, birthtimeMs: Date.now() });

vi.mock("node:fs/promises", () => ({
  mkdir: mockMkdir,
  writeFile: mockWriteFile,
  readFile: mockReadFile,
  unlink: mockUnlink,
  readdir: mockReaddir,
  stat: mockStat,
}));

vi.mock("fs/promises", () => ({
  mkdir: mockMkdir,
  writeFile: mockWriteFile,
  readFile: mockReadFile,
  unlink: mockUnlink,
  readdir: mockReaddir,
  stat: mockStat,
}));

vi.mock("zlib", () => ({
  gzip: vi.fn((_buffer, cb) => cb(null, Buffer.from("compressed"))),
  gunzip: vi.fn((_buffer, cb) => cb(null, Buffer.from("{}"))),
}));

vi.mock("node:zlib", () => ({
  gzip: vi.fn((_buffer, cb) => cb(null, Buffer.from("compressed"))),
  gunzip: vi.fn((_buffer, cb) => cb(null, Buffer.from("{}"))),
}));

vi.mock("util", () => ({
  // promisify returns a function that when called returns a promise
  promisify: vi.fn((fn) => (...args: unknown[]) => {
    return new Promise((resolve, _reject) => {
      fn(...args, (err: Error | null, result: unknown) => {
        if (err)
          resolve(result); // Handle non-callback cases if any
        else resolve(result);
      });
    });
  }),
}));

vi.mock("node:util", () => ({
  promisify: vi.fn((fn) => (...args: unknown[]) => {
    return new Promise((resolve) => {
      // Simple mock for promisify
      fn(...args, (_err: Error | null, result: unknown) => {
        resolve(result);
      });
    });
  }),
}));

vi.mock("path", () => ({
  dirname: vi.fn((path) => path.split("/").slice(0, -1).join("/")),
}));

vi.mock("node:path", () => ({
  dirname: vi.fn((path) => path.split("/").slice(0, -1).join("/")),
}));

// Helper to create test trace
function createTestTrace(id: string = "test_trace"): ExecutionTrace<string> {
  return {
    id,
    version: TRACE_SCHEMA_VERSION,
    startTime: Date.now() - 1000,
    endTime: Date.now(),
    events: [],
    checkpoints: [],
    metadata: {
      composition: "test",
      agentCount: 1,
      eventCount: 0,
      durationMs: 1000,
      schemaVersion: TRACE_SCHEMA_VERSION,
      operatorChain: [],
      includesPrompts: false,
      checkpointCount: 0,
    },
    finalOutput: "result",
  };
}

describe("FileStorage", () => {
  let storage: FileStorage;
  let _fsMock: typeof import("fs/promises");

  beforeEach(async () => {
    storage = new FileStorage();
    _fsMock = await import("node:fs/promises");
    vi.clearAllMocks();
  });

  describe("constructor", () => {
    it("should use default storage path", () => {
      const s = new FileStorage();
      expect(s.getBasePath()).toBe(DEFAULT_STORAGE_PATH);
    });

    it("should accept custom base path", () => {
      const s = new FileStorage({ basePath: "custom/__traces__" });
      expect(s.getBasePath()).toBe("custom/__traces__");
    });

    it("should accept compression option", () => {
      const s = new FileStorage({ compress: true });
      expect(s).toBeDefined();
    });
  });

  describe("save", () => {
    it("should save trace as JSON", async () => {
      const trace = createTestTrace();
      const path = await storage.save(trace);

      expect(path).toBe(`${DEFAULT_STORAGE_PATH}/test_trace.trace.json`);
      expect(mockWriteFile).toHaveBeenCalled();
    });

    it("should use trace ID as filename by default", async () => {
      const trace = createTestTrace("my_trace_123");
      const path = await storage.save(trace);

      expect(path).toContain("my_trace_123");
    });

    it("should accept custom filename", async () => {
      const trace = createTestTrace();
      const path = await storage.save(trace, "custom_name");

      expect(path).toBe(`${DEFAULT_STORAGE_PATH}/custom_name.trace.json`);
    });

    it("should create directory if needed", async () => {
      const trace = createTestTrace();
      await storage.save(trace);

      expect(mockMkdir).toHaveBeenCalled();
    });

    it("should use .gz extension when compressed", async () => {
      const compressedStorage = new FileStorage({ compress: true });
      const trace = createTestTrace();
      const path = await compressedStorage.save(trace);

      expect(path.endsWith(".trace.json.gz")).toBe(true);
    });
  });

  describe("load", () => {
    it("should load trace from full path", async () => {
      const trace = createTestTrace();
      mockReadFile.mockResolvedValueOnce(JSON.stringify(trace));

      const loaded = await storage.load(
        `${DEFAULT_STORAGE_PATH}/test.trace.json`,
      );

      expect(loaded).toBeDefined();
      expect(loaded.id).toBe("test_trace");
    });

    it("should load trace by ID", async () => {
      const trace = createTestTrace();
      mockReadFile.mockResolvedValueOnce(JSON.stringify(trace));

      const _loaded = await storage.load("test_trace");

      expect(mockReadFile).toHaveBeenCalled();
    });

    it("should throw for invalid JSON", async () => {
      mockReadFile.mockResolvedValueOnce("invalid json");

      await expect(storage.load("test")).rejects.toThrow(
        "Failed to parse trace file",
      );
    });
  });

  describe("exists", () => {
    it("should return true if trace exists", async () => {
      mockReadFile.mockResolvedValueOnce("{}");

      const exists = await storage.exists("test_trace");
      expect(exists).toBe(true);
    });

    it("should return false if trace does not exist", async () => {
      mockReadFile.mockRejectedValueOnce(new Error("ENOENT"));

      const exists = await storage.exists("nonexistent");
      expect(exists).toBe(false);
    });
  });

  describe("delete", () => {
    it("should delete trace file", async () => {
      await storage.delete("test_trace");
      expect(mockUnlink).toHaveBeenCalled();
    });
  });

  describe("list", () => {
    it("should list all trace files", async () => {
      mockReaddir.mockResolvedValueOnce([
        "trace1.trace.json",
        "trace2.trace.json.gz",
        "other.txt",
      ] as unknown as import("fs").Dirent[]);

      const traces = await storage.list();

      expect(traces).toHaveLength(2);
      expect(traces[0].filename).toBe("trace1.trace.json");
      expect(traces[0].compressed).toBe(false);
      expect(traces[1].filename).toBe("trace2.trace.json.gz");
      expect(traces[1].compressed).toBe(true);
    });

    it("should return empty array for empty directory", async () => {
      mockReaddir.mockResolvedValueOnce([]);

      const traces = await storage.list();
      expect(traces).toHaveLength(0);
    });

    it("should handle non-existent directory", async () => {
      mockReaddir.mockRejectedValueOnce(new Error("ENOENT"));

      const traces = await storage.list();
      expect(traces).toHaveLength(0);
    });

    it("should include file metadata", async () => {
      mockReaddir.mockResolvedValueOnce([
        "trace.trace.json",
      ] as unknown as import("fs").Dirent[]);
      mockStat.mockResolvedValueOnce({
        size: 2048,
        birthtimeMs: 1234567890,
      } as import("fs").Stats);

      const traces = await storage.list();

      expect(traces[0].sizeBytes).toBe(2048);
      expect(traces[0].createdAt).toBe(1234567890);
    });
  });

  describe("getBasePath", () => {
    it("should return configured base path", () => {
      const s = new FileStorage({ basePath: "my/path" });
      expect(s.getBasePath()).toBe("my/path");
    });
  });
});

describe("Utility Functions", () => {
  let _fsMock: typeof import("fs/promises");

  beforeEach(async () => {
    _fsMock = await import("node:fs/promises");
    vi.clearAllMocks();
  });

  describe("createStorage", () => {
    it("should create FileStorage with default path", () => {
      const storage = createStorage();
      expect(storage.getBasePath()).toBe(DEFAULT_STORAGE_PATH);
    });

    it("should create FileStorage with custom path", () => {
      const storage = createStorage("custom/path");
      expect(storage.getBasePath()).toBe("custom/path");
    });
  });

  describe("saveTrace", () => {
    it("should save trace to default location", async () => {
      const trace = createTestTrace();
      const path = await saveTrace(trace);

      expect(path).toContain(DEFAULT_STORAGE_PATH);
      expect(mockWriteFile).toHaveBeenCalled();
    });
  });

  describe("loadTrace", () => {
    it("should load trace from default location", async () => {
      const trace = createTestTrace();
      // Use the mock variable directly since vi.mocked might fail if types are weird
      mockReadFile.mockResolvedValueOnce(JSON.stringify(trace));

      const loaded = await loadTrace("test_trace");

      expect(loaded).toBeDefined();
    });
  });
});

describe("DEFAULT_STORAGE_PATH", () => {
  it("should be __traces__", () => {
    expect(DEFAULT_STORAGE_PATH).toBe("__traces__");
  });
});
