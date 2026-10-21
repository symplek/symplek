/**
 * @fileoverview Tests for Rollback Manager
 * @module @symplek/core/solo/__tests__/rollback
 *
 * 📝 BUILD[STORY-03.04]: Rollback tests
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearAllCheckpoints,
  clearOldCheckpoints,
  composeRollbackHandlers,
  createCheckpoint,
  createObjectRollbackHandler,
  executeWithRollback,
  getActiveCheckpoints,
  getCheckpoint,
  removeCheckpoint,
  withValidation,
} from "../rollback";

describe("Rollback Manager", () => {
  beforeEach(() => {
    clearAllCheckpoints();
  });

  afterEach(() => {
    clearAllCheckpoints();
  });

  describe("executeWithRollback", () => {
    it("should execute action successfully without rollback", async () => {
      let state = { value: 1 };

      const result = await executeWithRollback(
        async () => {
          state.value = 2;
          return "success";
        },
        {
          checkpoint: () => ({ ...state }),
          restore: (s) => {
            state = s;
          },
        },
      );

      expect(result).toBe("success");
      expect(state.value).toBe(2);
      expect(getActiveCheckpoints()).toHaveLength(0); // Checkpoint cleaned up
    });

    it("should rollback on action failure", async () => {
      let state = { value: 1 };

      await expect(
        executeWithRollback(
          async () => {
            state.value = 2;
            throw new Error("Action failed");
          },
          {
            checkpoint: () => ({ ...state }),
            restore: (s) => {
              state = s;
            },
          },
        ),
      ).rejects.toThrow("Action failed");

      expect(state.value).toBe(1); // State restored
      expect(getActiveCheckpoints()).toHaveLength(0); // Checkpoint cleaned up
    });

    it("should call onRollback callback", async () => {
      const onRollback = vi.fn();
      const state = { value: 1 };

      await expect(
        executeWithRollback(
          async () => {
            throw new Error("Failed");
          },
          {
            checkpoint: () => state,
            restore: () => {},
          },
          { onRollback },
        ),
      ).rejects.toThrow();

      expect(onRollback).toHaveBeenCalledTimes(1);
      expect(onRollback.mock.calls[0][0]).toMatch(/^chk_/);
    });

    it("should validate restored state when option enabled", async () => {
      let state = { value: 1 };
      const validator = vi.fn().mockReturnValue(true);

      await expect(
        executeWithRollback(
          async () => {
            throw new Error("Failed");
          },
          {
            checkpoint: () => ({ ...state }),
            restore: (s) => {
              state = s;
            },
            validate: validator,
          },
          { validateAfterRestore: true },
        ),
      ).rejects.toThrow("Failed");

      expect(validator).toHaveBeenCalledTimes(1);
    });

    it("should handle validation failure", async () => {
      let state = { value: 1 };
      const onRollbackError = vi.fn();

      await expect(
        executeWithRollback(
          async () => {
            throw new Error("Failed");
          },
          {
            checkpoint: () => ({ ...state }),
            restore: (s) => {
              state = s;
            },
            validate: () => false,
          },
          { validateAfterRestore: true, onRollbackError },
        ),
      ).rejects.toThrow("Rollback failed");

      expect(onRollbackError).toHaveBeenCalledTimes(1);
    });

    it("should retry rollback", async () => {
      let state = { value: 1 };
      let restoreAttempts = 0;

      await expect(
        executeWithRollback(
          async () => {
            throw new Error("Action failed");
          },
          {
            checkpoint: () => ({ ...state }),
            restore: () => {
              restoreAttempts++;
              if (restoreAttempts < 2) {
                throw new Error("Restore failed");
              }
              state = { value: 1 };
            },
          },
          { maxRetries: 3 },
        ),
      ).rejects.toThrow("Action failed");

      expect(restoreAttempts).toBe(2);
      expect(state.value).toBe(1);
    });
  });

  describe("createCheckpoint", () => {
    it("should create a checkpoint with unique ID", () => {
      const checkpoint = createCheckpoint({ value: 42 });

      expect(checkpoint.id).toMatch(/^chk_/);
      expect(checkpoint.state).toEqual({ value: 42 });
      expect(checkpoint.timestamp).toBeDefined();
    });

    it("should store checkpoint in active checkpoints", () => {
      const checkpoint = createCheckpoint({ value: 42 });

      const active = getActiveCheckpoints();
      expect(active).toHaveLength(1);
      expect(active[0].id).toBe(checkpoint.id);
    });

    it("should associate with transaction ID", () => {
      const checkpoint = createCheckpoint({ value: 42 }, "txn_123");

      expect(checkpoint.transactionId).toBe("txn_123");
    });
  });

  describe("getCheckpoint", () => {
    it("should retrieve checkpoint by ID", () => {
      const checkpoint = createCheckpoint({ value: 42 });
      const retrieved = getCheckpoint<{ value: number }>(checkpoint.id);

      expect(retrieved).toBeDefined();
      expect(retrieved?.state.value).toBe(42);
    });

    it("should return undefined for non-existent checkpoint", () => {
      expect(getCheckpoint("nonexistent")).toBeUndefined();
    });
  });

  describe("removeCheckpoint", () => {
    it("should remove checkpoint", () => {
      const checkpoint = createCheckpoint({ value: 42 });
      const removed = removeCheckpoint(checkpoint.id);

      expect(removed).toBe(true);
      expect(getCheckpoint(checkpoint.id)).toBeUndefined();
    });

    it("should return false for non-existent checkpoint", () => {
      expect(removeCheckpoint("nonexistent")).toBe(false);
    });
  });

  describe("clearOldCheckpoints", () => {
    it("should clear checkpoints older than specified time", () => {
      vi.useFakeTimers();
      const now = Date.now();
      vi.setSystemTime(now);

      createCheckpoint({ value: 1 }); // old

      vi.setSystemTime(now + 100);
      createCheckpoint({ value: 2 }); // new

      vi.setSystemTime(now + 200);
      const cleared = clearOldCheckpoints(150);

      expect(cleared).toBe(1);
      expect(getActiveCheckpoints()).toHaveLength(1);

      vi.useRealTimers();
    });
  });

  describe("createObjectRollbackHandler", () => {
    it("should create handler for object state", () => {
      let state = { value: 1 };
      const handler = createObjectRollbackHandler(
        () => state,
        (s) => {
          state = s;
        },
      );

      // Checkpoint
      const checkpoint = handler.checkpoint();
      expect(checkpoint).toEqual({ value: 1 });

      // Modify state
      state.value = 2;

      // Restore
      handler.restore(checkpoint);
      expect(state.value).toBe(1);
    });

    it("should deep clone state", () => {
      let state = { nested: { value: 1 } };
      const handler = createObjectRollbackHandler(
        () => state,
        (s) => {
          state = s;
        },
      );

      const checkpoint = handler.checkpoint();
      state.nested.value = 2;

      // Checkpoint should be unaffected
      expect(checkpoint.nested.value).toBe(1);
    });
  });

  describe("withValidation", () => {
    it("should add validation to handler", () => {
      const baseHandler = {
        checkpoint: () => ({ value: 1 }),
        restore: () => {},
      };

      const validator = (state: { value: number }) => state.value > 0;
      const handler = withValidation(baseHandler, validator);

      expect(handler.validate).toBeDefined();
      expect(handler.validate?.({ value: 1 })).toBe(true);
      expect(handler.validate?.({ value: -1 })).toBe(false);
    });
  });

  describe("composeRollbackHandlers", () => {
    it("should compose multiple handlers", async () => {
      const stateA = { a: 1 };
      const stateB = { b: 2 };

      const handlerA = {
        checkpoint: () => ({ a: stateA.a }),
        restore: (s: { a?: number }) => {
          if (s.a !== undefined) stateA.a = s.a;
        },
      };

      const handlerB = {
        checkpoint: () => ({ b: stateB.b }),
        restore: (s: { b?: number }) => {
          if (s.b !== undefined) stateB.b = s.b;
        },
      };

      const composed = composeRollbackHandlers<{ a: number; b: number }>([
        handlerA,
        handlerB,
      ]);

      // Checkpoint both
      const checkpoint = composed.checkpoint();
      expect(checkpoint).toEqual({ a: 1, b: 2 });

      // Modify both
      stateA.a = 10;
      stateB.b = 20;

      // Restore both
      await composed.restore(checkpoint);
      expect(stateA.a).toBe(1);
      expect(stateB.b).toBe(2);
    });
  });
});
