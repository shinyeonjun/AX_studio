import type { WorkflowIR } from '../../schema.js';
import type { ContractValidationIssue, WorkflowContractValidationOptions } from '../types.js';
import { validateTriggerConfiguration } from './trigger.js';
import { validateActionContract } from './action-contracts.js';
import {
  indexWorkflowSteps,
  validateControlFlowCycles,
  validateStepControlFlow,
} from './control-flow.js';
import { validateNotificationBranching } from './notifications.js';
import { validateWorkflowReferences } from './references-validation.js';

export function validateWorkflowStructure(
  ir: WorkflowIR,
  options: WorkflowContractValidationOptions = {},
): ContractValidationIssue[] {
  const issues: ContractValidationIssue[] = [...validateTriggerConfiguration(ir)];
  const { byId, issues: indexIssues } = indexWorkflowSteps(ir.steps);
  issues.push(...indexIssues);

  for (const step of ir.steps) {
    if (step.type === 'action') issues.push(...validateActionContract(step, options));
    issues.push(...validateStepControlFlow(step, byId));
  }

  issues.push(...validateControlFlowCycles(ir.steps, byId));
  issues.push(...validateNotificationBranching(ir));
  issues.push(...validateWorkflowReferences(ir, byId));
  return issues;
}
