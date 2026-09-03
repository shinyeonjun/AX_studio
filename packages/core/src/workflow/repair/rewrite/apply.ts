import type { WorkflowIR } from '../../schema.js';
import {
  RepairCandidateOperationSchema,
  type RepairCandidateOperation,
} from '../contract.js';
import { rewriteDocument } from './document.js';
import { rewriteActionStep, rewriteInputSchema } from './step.js';

/** Applies one explicitly selected rename candidate; it never changes policy fields. */
export function applyRepairCandidate(workflow: WorkflowIR, candidate: RepairCandidateOperation): WorkflowIR {
  const parsedCandidate = RepairCandidateOperationSchema.parse(candidate);
  const inputSchema = workflow.outputContract?.inputSchemas.find((entry) =>
    entry.sourceId === parsedCandidate.sourceId && entry.stepId === parsedCandidate.stepId,
  );
  if (!inputSchema || !inputSchema.columns.some((column) => column.name === parsedCandidate.from)) {
    throw new Error('repair_candidate_not_applicable');
  }
  if (inputSchema.columns.some((column) => column.name === parsedCandidate.to)) {
    throw new Error('repair_target_column_already_exists');
  }

  let changed = false;
  const steps = workflow.steps.map((step) => {
    if (step.type !== 'action') return step;
    const rewritten = rewriteActionStep(step, parsedCandidate);
    changed ||= rewritten.changed;
    return rewritten.step;
  });
  if (!changed) throw new Error('repair_candidate_not_applicable');

  const document = rewriteDocument(workflow.document, parsedCandidate);
  return {
    ...workflow,
    steps,
    outputContract: workflow.outputContract
      ? rewriteInputSchema(workflow.outputContract, parsedCandidate)
      : undefined,
    ...(document.document === undefined ? {} : { document: document.document }),
  };
}
