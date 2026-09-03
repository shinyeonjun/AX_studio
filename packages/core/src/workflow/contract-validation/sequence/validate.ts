import { stepsById } from '../../control-flow.js';
import type { ContractTypeName } from '../../../contracts/capability-io.js';
import type { Step, WorkflowIR } from '../../schema.js';
import type { BindingSource, ContractValidationIssue } from '../types.js';
import { mergeBranchAvailability, mergeGuaranteedSources } from './branches.js';
import { validateStepContracts } from './steps.js';

export function validateSequence(
  sequence: Step[],
  available: ContractTypeName[],
  guaranteedSources: Set<BindingSource>,
  ir: WorkflowIR,
  allSteps: Step[],
): { issues: ContractValidationIssue[]; available: ContractTypeName[]; guaranteedSources: Set<BindingSource> } {
  let current = available;
  let currentGuaranteed = new Set(guaranteedSources);
  const issues: ContractValidationIssue[] = [];

  for (const step of sequence) {
    if (step.type === 'if') {
      const guard = validateStepContracts(step, current, ir, currentGuaranteed);
      issues.push(...guard.issues);

      const thenResult = validateSequence(
        stepsById(allSteps, step.thenStepIds),
        current,
        currentGuaranteed,
        ir,
        allSteps,
      );
      const elseResult = validateSequence(
        stepsById(allSteps, step.elseStepIds ?? []),
        current,
        currentGuaranteed,
        ir,
        allSteps,
      );
      issues.push(...thenResult.issues, ...elseResult.issues);
      current = mergeBranchAvailability(current, thenResult.available, elseResult.available);
      currentGuaranteed = mergeGuaranteedSources(
        currentGuaranteed,
        thenResult.guaranteedSources,
        elseResult.guaranteedSources,
      );
      continue;
    }

    const result = validateStepContracts(step, current, ir, currentGuaranteed);
    issues.push(...result.issues);
    current = result.nextAvailable;
    currentGuaranteed.add(step.id);
  }

  return { issues, available: current, guaranteedSources: currentGuaranteed };
}
