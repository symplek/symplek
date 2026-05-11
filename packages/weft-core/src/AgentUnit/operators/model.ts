/**
 * @module weft-core/AgentUnit/operators/model
 * @description AgentUnit model selection operators: .model(), .quality()
 * @blast_radius HIGH
 * @status STABLE
 * @runtime browser|node
 * @surface internal
 */

import type { AgentComputation } from "../AgentUnit";
import { AgentUnit } from "../AgentUnit";

AgentUnit.prototype.model = function <T>(
  this: AgentUnit<T>,
  name: string,
): AgentUnit<T> {
  const selfComp = (this as unknown as { computation: AgentComputation<T> })
    .computation;
  const selfMeta = this.getMetadata();
  return AgentUnit._make<T>(
    async (ctx) => {
      const modelCtx = {
        ...ctx,
        extensions: { ...ctx.extensions, __Weft_model: name },
      };
      return selfComp(modelCtx);
    },
    {
      ...selfMeta,
      id: AgentUnit._generateId(),
      operatorChain: [...selfMeta.operatorChain, "model"],
      createdAt: Date.now(),
    },
  );
};

AgentUnit.prototype.quality = function <T>(
  this: AgentUnit<T>,
  level: "high" | "fast",
): AgentUnit<T> {
  const selfComp = (this as unknown as { computation: AgentComputation<T> })
    .computation;
  const selfMeta = this.getMetadata();
  return AgentUnit._make<T>(
    async (ctx) => {
      const qualityCtx = {
        ...ctx,
        extensions: { ...ctx.extensions, __Weft_quality: level },
      };
      return selfComp(qualityCtx);
    },
    {
      ...selfMeta,
      id: AgentUnit._generateId(),
      operatorChain: [...selfMeta.operatorChain, "quality"],
      createdAt: Date.now(),
    },
  );
};
