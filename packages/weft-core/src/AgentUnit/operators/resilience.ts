/**
 * @module AgentUnit/operators/resilience
 * @description AgentUnit resilience operator extensions (.fallback(), .orElse(), .retry(), .timeout()).
 * @blast_radius HIGH - All agent operations depend on these operators
 * @status STABLE
 * @runtime node
 * @surface internal
 */

import {
  createFallbackComputation,
  createRetryComputation,
  createTimeoutComputation,
} from "../../operators";
import { WeftError } from "../../errors";
import type { RetryOptions } from "../../types";
import type { AgentComputation } from "../AgentUnit";
import { AgentUnit } from "../AgentUnit";

AgentUnit.prototype.fallback = function <T>(
  this: AgentUnit<T>,
  other: AgentUnit<T>,
): AgentUnit<T> {
  const selfComp = (this as unknown as { computation: AgentComputation<T> })
    .computation;
  const otherComp = (other as unknown as { computation: AgentComputation<T> })
    .computation;
  const selfMeta = this.getMetadata();
  const otherMeta = other.getMetadata();
  return AgentUnit._make<T>(
    createFallbackComputation(selfComp, otherComp, selfMeta, otherMeta),
    {
      id: AgentUnit._generateId(),
      operatorChain: [...selfMeta.operatorChain, "fallback"],
      createdAt: Date.now(),
    },
  );
};

AgentUnit.prototype.orElse = function <T>(
  this: AgentUnit<T>,
  defaultValue: T,
): AgentUnit<T> {
  const selfComp = (this as unknown as { computation: AgentComputation<T> })
    .computation;
  const selfMeta = this.getMetadata();
  return AgentUnit._make<T>(
    async (ctx) => {
      try {
        return await selfComp(ctx);
      } catch {
        return defaultValue;
      }
    },
    {
      id: AgentUnit._generateId(),
      operatorChain: [...selfMeta.operatorChain, "orElse"],
      createdAt: Date.now(),
    },
  );
};

AgentUnit.prototype.retry = function <T>(
  this: AgentUnit<T>,
  maxAttempts = 3,
  options?: RetryOptions,
): AgentUnit<T> {
  if (maxAttempts < 1) {
    return AgentUnit.fail<T>(
      new WeftError({
        code: "SETUP_ERROR",
        why: `retry maxAttempts must be >= 1, got ${maxAttempts}`,
        action: "Pass a positive integer for maxAttempts.",
      }),
    );
  }
  const selfComp = (this as unknown as { computation: AgentComputation<T> })
    .computation;
  const selfMeta = this.getMetadata();
  return AgentUnit._make<T>(
    createRetryComputation(selfComp, selfMeta, { maxAttempts, ...options }),
    {
      id: AgentUnit._generateId(),
      operatorChain: [...selfMeta.operatorChain, "retry"],
      createdAt: Date.now(),
    },
  );
};

AgentUnit.prototype.timeout = function <T>(
  this: AgentUnit<T>,
  timeoutMs: number,
  message?: string,
): AgentUnit<T> {
  const selfComp = (this as unknown as { computation: AgentComputation<T> })
    .computation;
  const selfMeta = this.getMetadata();
  return AgentUnit._make<T>(
    createTimeoutComputation(selfComp, selfMeta, { timeoutMs, message }),
    {
      id: AgentUnit._generateId(),
      operatorChain: [...selfMeta.operatorChain, "timeout"],
      createdAt: Date.now(),
    },
  );
};
