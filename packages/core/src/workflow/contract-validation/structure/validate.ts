import type { WorkflowIR } from '../../schema.js';
import type { ContractValidationIssue, WorkflowContractValidationOptions } from '../types.js';
import { validateTriggerConfiguration } from './trigger.js';
import { validateActionContract } from './action-contracts.js';
import {
  indexWorkflowSteps,
  validateApprovalBranchOwnership,
  validateControlFlowCycles,
  validateStepControlFlow,
} from './control-flow.js';
import { validateNotificationBranching } from './notifications.js';
import { validateWorkflowReferences } from './references-validation.js';
import { decisionOutputContractErrors } from '../../ai-output-contract.js';

export function validateWorkflowStructure(
  ir: WorkflowIR,
  options: WorkflowContractValidationOptions = {},
): ContractValidationIssue[] {
  const issues: ContractValidationIssue[] = [...validateTriggerConfiguration(ir)];
  const { byId, issues: indexIssues } = indexWorkflowSteps(ir.steps);
  issues.push(...indexIssues);

  for (const step of ir.steps) {
    if (step.type === 'action') issues.push(...validateActionContract(step, options));
    if (step.type === 'ai_decision') {
      issues.push(...decisionOutputContractErrors(step).map((message): ContractValidationIssue => ({
        code: 'invalid_workflow_schema', stepId: step.id, message: `${step.id} 출력 계약: ${message}`,
      })));
    }
    issues.push(...validateStepControlFlow(step, byId));
  }

  issues.push(...validateControlFlowCycles(ir.steps, byId));
  issues.push(...validateApprovalBranchOwnership(ir.steps));
  issues.push(...validateNotificationBranching(ir));
  issues.push(...validateWorkflowReferences(ir, byId));
  return issues;
}
