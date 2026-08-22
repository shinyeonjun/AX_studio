export { linearContractSteps, linearSteps, skipInLinearScan, stepsById } from '../workflow/control-flow.js';
import type { Step } from '../workflow/schema.js';

export interface ExecutionCheckpoint {
  variables: Record<string, unknown>;
  stepResults: Record<string, unknown>;
  remainingStepIds: string[];
  /** Steps in outer sequences waiting after a nested branch completes. */
  pendingOuterStepIds?: string[];
}


export function isExecutionCheckpoint(value: unknown): value is ExecutionCheckpoint {
  if (!value || typeof value !== 'object') return false;
  const rec = value as Record<string, unknown>;
  return Boolean(rec.variables && rec.stepResults && Array.isArray(rec.remainingStepIds));
}
