import type { Step } from '../../schema.js';
import type { ContractValidationIssue } from '../types.js';

export function indexWorkflowSteps(steps: Step[]): {
  byId: Map<string, Step>;
  issues: ContractValidationIssue[];
} {
  const byId = new Map<string, Step>();
  const issues: ContractValidationIssue[] = [];
  for (const step of steps) {
    if (byId.has(step.id)) {
      issues.push({ code: 'invalid_control_flow', stepId: step.id, message: '노드 id가 중복되었습니다: ' + step.id });
    }
    byId.set(step.id, step);
  }
  return { byId, issues };
}

export function validateStepControlFlow(
  step: Step,
  byId: Map<string, Step>,
): ContractValidationIssue[] {
  const issues: ContractValidationIssue[] = [];
  if (step.type === 'if') {
    if (step.thenStepIds.length === 0) {
      issues.push({ code: 'invalid_control_flow', stepId: step.id, message: step.id + ' if 노드에 thenStepIds가 필요합니다.' });
    }
    for (const targetId of [...step.thenStepIds, ...(step.elseStepIds ?? [])]) {
      if (!byId.has(targetId)) {
        issues.push({ code: 'invalid_control_flow', stepId: step.id, message: step.id + '가 존재하지 않는 노드 ' + targetId + '를 가리킵니다.' });
      }
      if (targetId === step.id) {
        issues.push({ code: 'invalid_control_flow', stepId: step.id, message: step.id + ' if 노드는 자기 자신을 가리킬 수 없습니다.' });
      }
    }
  }
  if (step.type === 'human_approval') {
    if (step.forActionIds.length === 0) {
      issues.push({
        code: 'invalid_control_flow',
        stepId: step.id,
        message: step.id + ' 승인 노드에 승인 대상 action이 필요합니다.',
      });
    }
    for (const actionId of step.forActionIds) {
      const target = byId.get(actionId);
      if (!target || target.type !== 'action') {
        issues.push({
          code: 'invalid_control_flow',
          stepId: step.id,
          message: step.id + ' 승인 노드가 action이 아닌 ' + actionId + '를 가리킵니다.',
        });
      }
    }
  }
  return issues;
}

export function validateControlFlowCycles(
  steps: Step[],
  byId: Map<string, Step>,
): ContractValidationIssue[] {
  const issues: ContractValidationIssue[] = [];
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const reportedCycles = new Set<string>();
  const visit = (stepId: string, path: string[]) => {
    if (visiting.has(stepId)) {
      const start = path.indexOf(stepId);
      const cycle = [...path.slice(start >= 0 ? start : 0), stepId].join(' -> ');
      if (!reportedCycles.has(cycle)) {
        reportedCycles.add(cycle);
        issues.push({
          code: 'invalid_control_flow',
          stepId,
          message: 'if 분기 순환이 발견되었습니다: ' + cycle,
        });
      }
      return;
    }
    if (visited.has(stepId)) return;

    const current = byId.get(stepId);
    if (!current) return;
    visiting.add(stepId);
    if (current.type === 'if') {
      for (const targetId of [...current.thenStepIds, ...(current.elseStepIds ?? [])]) {
        visit(targetId, [...path, targetId]);
      }
    }
    visiting.delete(stepId);
    visited.add(stepId);
  };

  for (const step of steps) visit(step.id, [step.id]);
  return issues;
}
