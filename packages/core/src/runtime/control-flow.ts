export { linearContractSteps, linearSteps, skipInLinearScan, stepsById } from '../workflow/control-flow.js';
import type { Step } from '../workflow/schema.js';

export interface ExecutionCheckpoint {
  variables: Record<string, unknown>;
  stepResults: Record<string, unknown>;
  /** Validated output ports needed by steps after an approval resume. */
  outputs?: Record<string, Record<string, unknown>>;
  remainingStepIds: string[];
  /** Steps in outer sequences waiting after a nested branch completes. */
  pendingOuterStepIds?: string[];
}


export function isExecutionCheckpoint(value: unknown): value is ExecutionCheckpoint {
  if (!value || typeof value !== 'object') return false;
  const rec = value as Record<string, unknown>;
  const isRecord = (entry: unknown): entry is Record<string, unknown> =>
    Boolean(entry) && typeof entry === 'object' && !Array.isArray(entry);
  return Boolean(
    isRecord(rec.variables) &&
    isRecord(rec.stepResults) &&
    (rec.outputs === undefined || isRecord(rec.outputs)) &&
    Array.isArray(rec.remainingStepIds),
  );
}
