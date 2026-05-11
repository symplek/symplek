/**
 * @module AgentUnit/operators/tracking
 * @description AgentUnit source-tracking operator extension (.tracked()).
 * @blast_radius HIGH - All agent operations depend on these operators
 * @status STABLE
 * @runtime node
 * @surface internal
 */

import { createTrackedComputation } from "../../operators";
import type { SourceTrackingOptions, TrackedResult } from "../../types";
import type { AgentComputation } from "../AgentUnit";
import { AgentUnit } from "../AgentUnit";

AgentUnit.prototype.tracked = function <T>(
  this: AgentUnit<T>,
  options: SourceTrackingOptions,
): AgentUnit<TrackedResult<T>> {
  const selfComp = (this as unknown as { computation: AgentComputation<T> })
    .computation;
  const selfMeta = this.getMetadata();
  return AgentUnit._make<TrackedResult<T>>(
    createTrackedComputation(selfComp, selfMeta, options),
    {
      id: AgentUnit._generateId(),
      operatorChain: [...selfMeta.operatorChain, "tracked"],
      createdAt: Date.now(),
    },
  );
};
