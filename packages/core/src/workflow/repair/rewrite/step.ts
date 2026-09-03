import { TransformExprSchema } from '../../transform-expr/dsl.js';
import type { Step } from '../../schema.js';
import type { RepairCandidateOperation } from '../contract.js';
import type { OutputContract } from '../../../contracts/output-contract.js';
import { renameExpr } from './expression.js';

export function rewriteActionStep(step: Extract<Step, { type: 'action' }>, candidate: RepairCandidateOperation): { step: Step; changed: boolean } {
  if (step.connector !== 'transform' || step.action !== 'evaluate') return { step, changed: false };
  const parsed = TransformExprSchema.safeParse(step.params.expr);
  if (!parsed.success) return { step, changed: false };
  const rewritten = renameExpr(parsed.data, candidate);
  if (!rewritten.changed) return { step, changed: false };
  return {
    step: {
      ...step,
      params: { ...step.params, expr: rewritten.expr },
    },
    changed: true,
  };
}

export function rewriteInputSchema(contract: OutputContract, candidate: RepairCandidateOperation): OutputContract {
  return {
    ...contract,
    inputSchemas: contract.inputSchemas.map((schema) => {
      if (schema.sourceId !== candidate.sourceId || schema.stepId !== candidate.stepId) return schema;
      return {
        ...schema,
        columns: schema.columns.map((column) =>
          column.name === candidate.from ? { ...column, name: candidate.to } : column),
      };
    }),
  };
}
