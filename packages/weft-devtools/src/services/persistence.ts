import { type DBSchema, type IDBPDatabase, openDB } from "idb";
import type { ExecutionStepPayload, MetricsPayload } from "../bridge/types";

export interface StoredExecution {
  executionId: string;
  workflowName: string;
  startTime: number;
  endTime?: number;
  status: "running" | "complete" | "error";
  metrics: MetricsPayload["metrics"];
  stepCount: number;
}

export interface ExecutionStep extends ExecutionStepPayload {
  id: string; // Internal ID for steps
}

interface DevToolsDB extends DBSchema {
  executions: {
    key: string;
    value: StoredExecution;
    indexes: { "by-timestamp": number; "by-workflow": string };
  };
  steps: {
    key: string;
    value: ExecutionStep;
    indexes: { "by-execution": string };
  };
}

const DB_NAME = "Weft-devtools-db";
const DB_VERSION = 1;
const MAX_AGE_MS = 60 * 60 * 1000; // 1 hour TTL

export class DevToolsPersistence {
  private db: IDBPDatabase<DevToolsDB> | null = null;

  async init(): Promise<void> {
    if (this.db) return;

    this.db = await openDB<DevToolsDB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        const executionStore = db.createObjectStore("executions", {
          keyPath: "executionId",
        });
        executionStore.createIndex("by-timestamp", "startTime");
        executionStore.createIndex("by-workflow", "workflowName");

        const stepStore = db.createObjectStore("steps", {
          keyPath: "id",
          autoIncrement: true,
        });
        stepStore.createIndex("by-execution", "executionId");
      },
    });

    // Initial cleanup
    await this.clearOldExecutions();
  }

  async saveExecution(execution: StoredExecution): Promise<void> {
    if (!this.db) await this.init();
    await this.db?.put("executions", execution);
  }

  async saveStep(step: ExecutionStepPayload): Promise<void> {
    if (!this.db) await this.init();
    const id = `${step.executionId}-${step.stepId}-${step.type}`;
    await this.db?.put("steps", { ...step, id });
  }

  async getExecution(
    executionId: string,
  ): Promise<StoredExecution | undefined> {
    if (!this.db) await this.init();
    return this.db?.get("executions", executionId);
  }

  async getRecentExecutions(limit = 50): Promise<StoredExecution[]> {
    if (!this.db) await this.init();
    // db is non-null after init(); the optional-chain in saveExecution is defensive
    // but here we need the non-null db to open a transaction directly.
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const db = this.db!;
    const tx = db.transaction("executions", "readonly");
    const index = tx.store.index("by-timestamp");
    let cursor = await index.openCursor(null, "prev");
    const results: StoredExecution[] = [];

    while (cursor && results.length < limit) {
      results.push(cursor.value);
      cursor = await cursor.continue();
    }

    return results;
  }

  async getStepsForExecution(executionId: string): Promise<ExecutionStep[]> {
    if (!this.db) await this.init();
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    return this.db!.getAllFromIndex("steps", "by-execution", executionId);
  }

  async clearOldExecutions(maxAge = MAX_AGE_MS): Promise<void> {
    if (!this.db) await this.init();
    const cutoff = Date.now() - maxAge;
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const db = this.db!;
    const tx = db.transaction(["executions", "steps"], "readwrite");
    const executionStore = tx.objectStore("executions");
    const stepStore = tx.objectStore("steps");
    const index = executionStore.index("by-timestamp");

    let cursor = await index.openCursor(IDBKeyRange.upperBound(cutoff));
    while (cursor) {
      const executionId = cursor.value.executionId;

      // Fix N45: reassign stepCursor each iteration — without this assignment
      // the while loop never terminates because `const stepCursor` holds the
      // initial cursor reference and `await stepCursor.continue()` returns the
      // next cursor but the loop condition never sees the updated value.
      let stepCursor = await stepStore
        .index("by-execution")
        .openKeyCursor(IDBKeyRange.only(executionId));
      while (stepCursor) {
        await stepStore.delete(stepCursor.primaryKey);
        stepCursor = await stepCursor.continue();
      }

      await cursor.delete();
      cursor = await cursor.continue();
    }

    await tx.done;
  }

  async deleteExecution(executionId: string): Promise<void> {
    if (!this.db) await this.init();
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const db = this.db!;
    const tx = db.transaction(["executions", "steps"], "readwrite");
    await tx.objectStore("executions").delete(executionId);

    const stepStore = tx.objectStore("steps");
    const stepIndex = stepStore.index("by-execution");
    // Fix N45 companion: reassign cursor each iteration to prevent infinite loop.
    let stepCursor = await stepIndex.openKeyCursor(
      IDBKeyRange.only(executionId),
    );
    while (stepCursor) {
      await stepStore.delete(stepCursor.primaryKey);
      stepCursor = await stepCursor.continue();
    }

    await tx.done;
  }
}

export const persistence = new DevToolsPersistence();
