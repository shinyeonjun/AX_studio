import { resolveCapability } from '../../../catalog/capability-graph.js';
import type { Step, WorkflowIR } from '../../schema.js';
import type { ContractValidationIssue } from '../types.js';

export function validateNotificationBranching(ir: WorkflowIR): ContractValidationIssue[] {
  const notifyActions = ir.steps.filter(
    (step): step is Extract<Step, { type: 'action' }> =>
      step.type === 'action' && resolveCapability(step.connector, step.action)?.notification === true,
  );
  const decisionSteps = ir.steps.filter((step) => step.type === 'ai_decision');
  const branchSteps = ir.steps.filter((step) => step.type === 'if');
  if (notifyActions.length < 2 || decisionSteps.length === 0) return [];

  if (branchSteps.length === 0) {
    return [{
      code: 'invalid_control_flow',
      message: 'AI 분류 결과를 사용하는 알림 목적지는 if 분기로 나눠야 합니다.',
    }];
  }

  const issues: ContractValidationIssue[] = [];
  const branchEntries = new Set(branchSteps.flatMap((step) => [...step.thenStepIds, ...(step.elseStepIds ?? [])]));
  for (const approval of ir.steps) {
    if (approval.type === 'human_approval' && branchEntries.has(approval.id)) {
      approval.forActionIds.forEach((actionId) => branchEntries.add(actionId));
    }
  }
  for (const action of notifyActions) {
    if (!branchEntries.has(action.id)) {
      issues.push({
        code: 'invalid_control_flow',
        stepId: action.id,
        message: action.id + ' 알림 action이 if 분기에 연결되지 않았습니다.',
      });
    }
  }
  return issues;
}
