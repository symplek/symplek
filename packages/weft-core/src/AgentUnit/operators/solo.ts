/**
 * @module @weft/core/AgentUnit/operators/solo
 * @description AgentUnit solo operator: .solo()
 * @blast_radius HIGH
 * @status STABLE
 * @runtime browser|node
 * @surface internal
 */

import { createSoloComputation } from "../../operators";
import type { SoloConfig, SoloResult } from "../../solo/types";
import type { AgentComputation } from "../AgentUnit";
import { AgentUnit } from "../AgentUnit";

AgentUnit.prototype.solo = function <T>(
  this: AgentUnit<T>,
  config: SoloConfig = {},
): AgentUnit<SoloResult<T>> {
  const selfComp = (this as unknown as { computation: AgentComputation<T> })
    .computation;
  const selfMeta = this.getMetadata();
  return AgentUnit._make<SoloResult<T>>(
    createSoloComputation(selfComp, selfMeta, config),
    {
      ...selfMeta,
      id: AgentUnit._generateId(),
      operatorChain: [...selfMeta.operatorChain, "solo"],
      createdAt: Date.now(),
    },
  );
};
