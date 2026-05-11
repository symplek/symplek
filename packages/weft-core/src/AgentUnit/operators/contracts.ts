/**
 * @module AgentUnit/operators/contracts
 * @description AgentUnit contract validation operator extensions (.provides(), .expects()).
 * @blast_radius HIGH - All agent operations depend on these operators
 * @status STABLE
 * @runtime node
 * @surface internal
 */

import type { z } from "zod";
import {
  ContractError,
  type ContractOptions,
  zodErrorToMismatches,
} from "../../contract";
import type { AgentContext } from "../../types";
import type { AgentComputation } from "../AgentUnit";
import { AgentUnit } from "../AgentUnit";

AgentUnit.prototype.provides = function <T, TSchema extends z.ZodType>(
  this: AgentUnit<T>,
  schema: TSchema,
  options?: ContractOptions,
): AgentUnit<z.infer<TSchema>> {
  const selfComp = (this as unknown as { computation: AgentComputation<T> })
    .computation;
  const selfMeta = this.getMetadata();
  const strict = options?.strict ?? false;
  const effectiveSchema =
    strict && "strict" in schema && typeof schema.strict === "function"
      ? (schema.strict() as TSchema)
      : schema;

  return AgentUnit._make<z.infer<TSchema>>(
    async (ctx) => {
      const value = await selfComp(ctx);
      const result = effectiveSchema.safeParse(value);
      if (!result.success) {
        throw new ContractError(
          selfMeta.id,
          "output",
          zodErrorToMismatches(result.error),
        );
      }
      return result.data;
    },
    {
      ...selfMeta,
      id: AgentUnit._generateId(),
      operatorChain: [...selfMeta.operatorChain, "provides"],
      createdAt: Date.now(),
    },
  );
};

AgentUnit.prototype.expects = function <T, TSchema extends z.ZodType>(
  this: AgentUnit<T>,
  schema: TSchema,
  inputSelector: (ctx: AgentContext) => unknown,
): AgentUnit<T> {
  const selfComp = (this as unknown as { computation: AgentComputation<T> })
    .computation;
  const selfMeta = this.getMetadata();
  return AgentUnit._make<T>(
    async (ctx) => {
      const input = inputSelector(ctx);
      const result = schema.safeParse(input);
      if (!result.success) {
        throw new ContractError(
          "input",
          selfMeta.id,
          zodErrorToMismatches(result.error),
        );
      }
      return selfComp(ctx);
    },
    {
      ...selfMeta,
      id: AgentUnit._generateId(),
      operatorChain: [...selfMeta.operatorChain, "expects"],
      createdAt: Date.now(),
    },
  );
};
