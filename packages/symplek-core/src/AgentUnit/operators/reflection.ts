/**
 * @module AgentUnit/operators/reflection
 * @description AgentUnit reflect operator extension (.reflect()) — recursive self-review.
 * @blast_radius MEDIUM - Adds the reflect operator to every AgentUnit instance.
 * @status STABLE
 * @runtime node
 * @surface internal
 */

import { createReflectComputation } from "../../operators/reflect";
import { REFLECT_MAX_DEPTH } from "../../operators/reflect";
import type { ReflectOptions, ReflectResult } from "../../types";
import type { AgentComputation } from "../AgentUnit";
import { AgentUnit } from "../AgentUnit";

AgentUnit.prototype.reflect = function <T>(
  this: AgentUnit<T>,
  options?: ReflectOptions<T>,
): AgentUnit<ReflectResult<T>> {
  const selfComp = (this as unknown as { computation: AgentComputation<T> })
    .computation;
  const selfMeta = this.getMetadata();
  return AgentUnit._make<ReflectResult<T>>(
    createReflectComputation(selfComp, options ?? {}),
    {
      id: AgentUnit._generateId(),
      operatorChain: [...selfMeta.operatorChain, "reflect"],
      createdAt: Date.now(),
    },
  );
};
