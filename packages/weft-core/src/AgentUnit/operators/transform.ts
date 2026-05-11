/**
 * @module AgentUnit/operators/transform
 * @description AgentUnit conditional routing operator (.branch()).
 *   Note: .map(), .flatMap(), .chain(), .tap() are direct class methods in AgentUnit.ts.
 * @blast_radius HIGH
 * @status STABLE
 * @runtime node
 * @surface internal
 */

import type { AgentComputation } from "../AgentUnit";
import { AgentUnit } from "../AgentUnit";

AgentUnit.prototype.branch = function <T, U>(
  this: AgentUnit<T>,
  pred: (value: T) => boolean,
  ifTrue: (value: T) => AgentUnit<U>,
  ifFalse: (value: T) => AgentUnit<U>,
): AgentUnit<U> {
  const selfComp = (this as unknown as { computation: AgentComputation<T> })
    .computation;
  const selfMeta = this.getMetadata();
  return AgentUnit._make<U>(
    async (ctx) => {
      const value = await selfComp(ctx);
      const next = pred(value) ? ifTrue(value) : ifFalse(value);
      return (
        next as unknown as { computation: AgentComputation<U> }
      ).computation(ctx);
    },
    {
      ...selfMeta,
      id: AgentUnit._generateId(),
      operatorChain: [...selfMeta.operatorChain, "branch"],
      createdAt: Date.now(),
    },
  );
};
