import type { Step } from '../workflow/schema.js';

export interface ExecutionCheckpoint {
  variables: Record<string, unknown>;
  stepResults: Record<string, unknown>;
  remainingStepIds: string[];
  /** Steps in outer sequences waiting after a nested branch completes. */
  pendingOuterStepIds?: string[];
}

/** Steps that only run when an `if` jumps to them, or after approval. */
export function skipInLinearScan(steps: Step[]): Set<string> {
  const skip = new Set<string>();
  for (const step of steps) {
    if (step.type === 'if') {
      for (const id of step.thenStepIds) skip.add(id);
      for (const id of step.elseStepIds ?? []) skip.add(id);
    }
    if (step.type === 'human_approval') {
      for (const id of step.forActionIds) skip.add(id);
    }
  }
  return skip;
}

export function linearSteps(steps: Step[]): Step[] {
  const skip = skipInLinearScan(steps);
  return steps.filter((step) => !skip.has(step.id));
}

export function stepsById(steps: Step[], ids: string[]): Step[] {
  const map = new Map(steps.map((step) => [step.id, step]));
  return ids.flatMap((id) => {
    const step = map.get(id);
    return step ? [step] : [];
  });
}

export function isExecutionCheckpoint(value: unknown): value is ExecutionCheckpoint {
  if (!value || typeof value !== 'object') return false;
  const rec = value as Record<string, unknown>;
  return Boolean(rec.variables && rec.stepResults && Array.isArray(rec.remainingStepIds));
}
