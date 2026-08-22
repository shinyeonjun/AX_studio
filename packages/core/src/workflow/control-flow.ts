import type { Step } from './schema.js';

function skipIdsForLinearScan(steps: Step[], includeApprovalActions: boolean): Set<string> {
  const skip = new Set<string>();
  const branchTargets = new Set<string>();
  for (const step of steps) {
    if (step.type !== 'if') continue;
    for (const id of step.thenStepIds) branchTargets.add(id);
    for (const id of step.elseStepIds ?? []) branchTargets.add(id);
  }

  for (const step of steps) {
    if (step.type === 'if') {
      for (const id of step.thenStepIds) skip.add(id);
      for (const id of step.elseStepIds ?? []) skip.add(id);
    }
    if (step.type === 'human_approval') {
      // A compiler-generated approval used to be inserted into the flat list
      // before an action. Action execution now owns approval, so a legacy gate
      // outside an IF branch must not fire on every run. Keep branch-local
      // approval nodes reachable for backward-compatible explicit workflows.
      if (!branchTargets.has(step.id)) {
        skip.add(step.id);
        if (includeApprovalActions) {
          for (const id of step.forActionIds) skip.add(id);
        }
      } else {
        for (const id of step.forActionIds) skip.add(id);
      }
    }
  }
  return skip;
}

/** Top-level execution sequence; action execution owns external approval. */
export function linearSteps(steps: Step[]): Step[] {
  const skip = skipIdsForLinearScan(steps, false);
  return steps.filter((step) => !skip.has(step.id));
}

/** Contract/inference sequence; gated actions are not guaranteed before approval. */
export function linearContractSteps(steps: Step[]): Step[] {
  const skip = skipIdsForLinearScan(steps, true);
  return steps.filter((step) => !skip.has(step.id));
}

/** Backward-compatible name for contract-oriented callers. */
export function skipInLinearScan(steps: Step[]): Set<string> {
  return skipIdsForLinearScan(steps, true);
}

export function stepsById(steps: Step[], ids: string[]): Step[] {
  const map = new Map(steps.map((step) => [step.id, step]));
  return ids.flatMap((id) => {
    const step = map.get(id);
    return step ? [step] : [];
  });
}
