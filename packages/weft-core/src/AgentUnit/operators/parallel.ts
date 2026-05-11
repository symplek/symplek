/**
 * @module AgentUnit/operators/parallel
 * @description AgentUnit parallel operator extension (.zip()).
 *   Static parallel methods (.zipAll(), .race()) remain in the class shell.
 * @blast_radius HIGH - All agent operations depend on these operators
 * @status STABLE
 * @runtime node
 * @surface internal
 */

import type { AgentComputation } from "../AgentUnit";
import { AgentUnit } from "../AgentUnit";

AgentUnit.prototype.zip = function <T, U>(
  this: AgentUnit<T>,
  other: AgentUnit<U>,
): AgentUnit<[T, U]> {
  const selfComp = (this as unknown as { computation: AgentComputation<T> })
    .computation;
  const otherComp = (other as unknown as { computation: AgentComputation<U> })
    .computation;
  const selfMeta = this.getMetadata();
  return AgentUnit._make<[T, U]>(
    async (ctx) => {
      const [a, b] = await Promise.all([selfComp(ctx), otherComp(ctx)]);
      return [a, b] as [T, U];
    },
    {
      id: AgentUnit._generateId(),
      operatorChain: [...selfMeta.operatorChain, "zip"],
      isParallel: true,
      createdAt: Date.now(),
    },
  );
};
