import type { Step, WorkflowIR } from '../../schema.js';
import type { ContractValidationIssue } from '../types.js';
import {
  conditionReferencePaths,
  outputFieldExists,
  outputFieldIsRequired,
  referencePaths,
} from './references.js';

export function validateWorkflowReferences(
  ir: WorkflowIR,
  byId: Map<string, Step>,
): ContractValidationIssue[] {
  const refs = ir.steps.flatMap((step) => {
    if (step.type === 'if') return conditionReferencePaths(step.condition);
    if (step.type === 'action') {
      const bindingRefs = Object.values(step.bindings ?? {})
        .filter((binding) => binding.from !== 'trigger')
        .map((binding) => binding.from + '.' + binding.output);
      return [...referencePaths(step.params), ...bindingRefs];
    }
    return [];
  });
  const issues: ContractValidationIssue[] = [];
  const reportedReferences = new Set<string>();
  for (const reference of refs) {
    const [root, field] = reference.split('.', 2);
    if (!root || !field || root === 'trigger' || (ir.inputs ?? []).includes(root)) continue;
    const source = byId.get(root);
    if (!source || source.type !== 'ai_decision') continue;
    if (!outputFieldExists(source, field)) {
      const issueKey = source.id + ':' + field + ':declared';
      if (reportedReferences.has(issueKey)) continue;
      reportedReferences.add(issueKey);
      issues.push({
        code: 'invalid_workflow_reference',
        stepId: source.id,
        message: source.id + ' 결과에 선언되지 않은 출력 필드 ' + field + '를 참조합니다.',
      });
      continue;
    }
    if (!outputFieldIsRequired(source, field)) {
      const issueKey = source.id + ':' + field + ':required';
      if (reportedReferences.has(issueKey)) continue;
      reportedReferences.add(issueKey);
      issues.push({
        code: 'invalid_workflow_reference',
        stepId: source.id,
        message: source.id + '.' + field + '는 분기 또는 후속 action에서 사용되므로 outputSchema.required에 포함되어야 합니다.',
      });
    }
  }
  return issues;
}
