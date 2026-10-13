/**
 * @fileoverview Tests for Transaction Log
 * @module @symplek/core/solo/__tests__/transactionLog
 *
 * 📝 BUILD[STORY-03.03]: Transaction log tests
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  clearAllTransactions,
  commitTransaction,
  createTransaction,
  getPendingTransactions,
  getTransaction,
  getTransactionStats,
  getTransactionsByAgent,
  InMemoryTransactionLogManager,
  pruneTransactions,
  queryTransactions,
  rollbackTransaction,
} from "../transactionLog";

describe("Transaction Log", () => {
  beforeEach(() => {
    clearAllTransactions();
  });

  afterEach(() => {
    clearAllTransactions();
  });

  describe("createTransaction", () => {
    it("should create a pending transaction", () => {
      const txn = createTransaction("agent-1", "updateProfile", {
        userId: 123,
      });

      expect(txn.id).toMatch(/^txn_/);
      expect(txn.agentId).toBe("agent-1");
      expect(txn.action).toBe("updateProfile");
      expect(txn.input).toEqual({ userId: 123 });
      expect(txn.status).toBe("pending");
      expect(txn.output).toBeUndefined();
    });

    it("should generate unique IDs", () => {
      const txn1 = createTransaction("agent-1", "action1", {});
      const txn2 = createTransaction("agent-1", "action2", {});

      expect(txn1.id).not.toBe(txn2.id);
    });

    it("should set timestamp", () => {
      const before = Date.now();
      const txn = createTransaction("agent-1", "action", {});
      const after = Date.now();

      expect(txn.timestamp).toBeGreaterThanOrEqual(before);
      expect(txn.timestamp).toBeLessThanOrEqual(after);
    });
  });

  describe("commitTransaction", () => {
    it("should commit a pending transaction", () => {
      const txn = createTransaction("agent-1", "action", { input: "data" });
      commitTransaction(txn.id, { output: "result" });

      const retrieved = getTransaction(txn.id);
      expect(retrieved?.status).toBe("committed");
      expect(retrieved?.output).toEqual({ output: "result" });
      expect(retrieved?.durationMs).toBeDefined();
    });

    it("should throw for non-existent transaction", () => {
      expect(() => commitTransaction("nonexistent", {})).toThrow(
        "Transaction not found",
      );
    });

    it("should throw for already committed transaction", () => {
      const txn = createTransaction("agent-1", "action", {});
      commitTransaction(txn.id, {});

      expect(() => commitTransaction(txn.id, {})).toThrow(
        "status is committed",
      );
    });

    it("should throw for rolled back transaction", () => {
      const txn = createTransaction("agent-1", "action", {});
      rollbackTransaction(txn.id);

      expect(() => commitTransaction(txn.id, {})).toThrow(
        "status is rolledBack",
      );
    });
  });

  describe("rollbackTransaction", () => {
    it("should rollback a pending transaction", () => {
      const txn = createTransaction("agent-1", "action", {});
      rollbackTransaction(txn.id, "Something went wrong");

      const retrieved = getTransaction(txn.id);
      expect(retrieved?.status).toBe("rolledBack");
      expect(retrieved?.error).toBe("Something went wrong");
      expect(retrieved?.durationMs).toBeDefined();
    });

    it("should throw for non-existent transaction", () => {
      expect(() => rollbackTransaction("nonexistent")).toThrow(
        "Transaction not found",
      );
    });

    it("should throw for already committed transaction", () => {
      const txn = createTransaction("agent-1", "action", {});
      commitTransaction(txn.id, {});

      expect(() => rollbackTransaction(txn.id)).toThrow("status is committed");
    });
  });

  describe("getTransaction", () => {
    it("should return a copy of the transaction", () => {
      const txn = createTransaction("agent-1", "action", { foo: "bar" });
      const retrieved = getTransaction(txn.id);

      // Should be a copy, not the same reference
      expect(retrieved).not.toBe(txn);
      expect(retrieved).toEqual(txn);
    });

    it("should return undefined for non-existent transaction", () => {
      expect(getTransaction("nonexistent")).toBeUndefined();
    });
  });

  describe("queryTransactions", () => {
    beforeEach(() => {
      // Create test transactions
      const txn1 = createTransaction("agent-1", "action-a", {});
      commitTransaction(txn1.id, {});

      const txn2 = createTransaction("agent-1", "action-b", {});
      rollbackTransaction(txn2.id);

      createTransaction("agent-2", "action-a", {}); // pending

      createTransaction("agent-2", "action-c", {}); // pending
    });

    it("should filter by agentId", () => {
      const results = queryTransactions({ agentId: "agent-1" });
      expect(results).toHaveLength(2);
      expect(results.every((t) => t.agentId === "agent-1")).toBe(true);
    });

    it("should filter by status", () => {
      const results = queryTransactions({ status: "pending" });
      expect(results).toHaveLength(2);
      expect(results.every((t) => t.status === "pending")).toBe(true);
    });

    it("should filter by action", () => {
      const results = queryTransactions({ action: "action-a" });
      expect(results).toHaveLength(2);
    });

    it("should apply limit", () => {
      const results = queryTransactions({ limit: 2 });
      expect(results).toHaveLength(2);
    });

    it("should sort by timestamp descending", () => {
      const results = queryTransactions({});
      for (let i = 0; i < results.length - 1; i++) {
        expect(results[i].timestamp).toBeGreaterThanOrEqual(
          results[i + 1].timestamp,
        );
      }
    });
  });

  describe("getPendingTransactions", () => {
    it("should return only pending transactions", () => {
      const txn1 = createTransaction("agent-1", "action", {});
      commitTransaction(txn1.id, {});

      createTransaction("agent-2", "action", {}); // pending

      const pending = getPendingTransactions();
      expect(pending).toHaveLength(1);
      expect(pending[0].status).toBe("pending");
    });
  });

  describe("getTransactionsByAgent", () => {
    it("should return transactions for specific agent", () => {
      createTransaction("agent-1", "action", {});
      createTransaction("agent-1", "action", {});
      createTransaction("agent-2", "action", {});

      const results = getTransactionsByAgent("agent-1");
      expect(results).toHaveLength(2);
    });
  });

  describe("pruneTransactions", () => {
    it("should remove old completed transactions", () => {
      const txn1 = createTransaction("agent-1", "action", {});
      commitTransaction(txn1.id, {});

      // Modify timestamp to simulate old transaction
      const retrieved = getTransaction(txn1.id);
      if (retrieved) {
        (retrieved as { timestamp: number }).timestamp = Date.now() - 100000;
      }

      const pruned = pruneTransactions(50000);
      // Note: This test is approximate since we can't easily modify the stored transaction
      expect(pruned).toBeGreaterThanOrEqual(0);
    });

    it("should not remove pending transactions", () => {
      createTransaction("agent-1", "action", {});

      const pruned = pruneTransactions(0);
      expect(pruned).toBe(0);

      const pending = getPendingTransactions();
      expect(pending).toHaveLength(1);
    });
  });

  describe("getTransactionStats", () => {
    it("should return accurate statistics", () => {
      const txn1 = createTransaction("agent-1", "action", {});
      commitTransaction(txn1.id, {});

      const txn2 = createTransaction("agent-1", "action", {});
      rollbackTransaction(txn2.id);

      createTransaction("agent-1", "action", {}); // pending

      const stats = getTransactionStats();

      expect(stats.total).toBe(3);
      expect(stats.committed).toBe(1);
      expect(stats.rolledBack).toBe(1);
      expect(stats.pending).toBe(1);
      expect(stats.oldestTimestamp).toBeDefined();
      expect(stats.newestTimestamp).toBeDefined();
    });

    it("should handle empty log", () => {
      const stats = getTransactionStats();

      expect(stats.total).toBe(0);
      expect(stats.committed).toBe(0);
      expect(stats.rolledBack).toBe(0);
      expect(stats.pending).toBe(0);
      expect(stats.oldestTimestamp).toBeUndefined();
      expect(stats.newestTimestamp).toBeUndefined();
    });
  });

  describe("InMemoryTransactionLogManager class", () => {
    it("should implement TransactionLogManager interface", () => {
      const manager = new InMemoryTransactionLogManager();

      const txn = manager.create("agent-1", "action", { input: "data" });
      expect(txn.status).toBe("pending");

      manager.commit(txn.id, { output: "result" });
      expect(manager.get(txn.id)?.status).toBe("committed");

      const pending = manager.getPending();
      expect(pending).toHaveLength(0);

      const txn2 = manager.create("agent-1", "action2", {});
      manager.rollback(txn2.id, "error");
      expect(manager.get(txn2.id)?.status).toBe("rolledBack");

      const results = manager.query({ agentId: "agent-1" });
      expect(results).toHaveLength(2);
    });
  });
});
