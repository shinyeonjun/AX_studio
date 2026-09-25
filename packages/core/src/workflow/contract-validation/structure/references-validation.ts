import type { Step, WorkflowIR } from '../../schema.js';
import { classifyDecisionOutput } from '../../../contracts/decision.js';
import { resolveCapability } from '../../../catalog/capability-graph.js';
import type { CapabilityParamInputType } from '../../../catalog/capability-types.js';
import type { ContractTypeName } from '../../../contracts/capability-io.js';
import type { ContractValidationIssue } from '../types.js';
import {
  conditionReferencePaths,
  outputFieldExists,
  outputFieldIsRequired,
  referencePaths,
} from './references.js';

type AiDecisionStep = Extract<Step, { type: 'ai_decision' }>;

function outputFieldSchema(source: AiDecisionStep, field: string): Record<string, unknown> | undefined {
  const properties = source.outputSchema?.properties;
  if (!properties || typeof properties !== 'object' || Array.isArray(properties)) return undefined;
  const definition = (properties as Record<string, unknown>)[field];
  return definition && typeof definition === 'object' && !Array.isArray(definition)
    ? definition as Record<string, unknown>
    : undefined;
}

function hasOutputFieldDefinition(source: AiDecisionStep, field: string): boolean {
  const properties = source.outputSchema?.properties;
  return Boolean(properties
    && typeof properties === 'object'
    && !Array.isArray(properties)
    && Object.hasOwn(properties, field));
}

function isProducedWithoutLlm(source: AiDecisionStep, field: string): boolean {
  const kind = classifyDecisionOutput(outputFieldSchema(source, field)).kind;
  return kind === 'boolean' || kind === 'choice' || kind === 'constant';
}

function isStringChoiceOutput(source: AiDecisionStep, field: string): boolean {
  const route = classifyDecisionOutput(outputFieldSchema(source, field));
  return (route.kind === 'constant' && typeof route.value === 'string')
    || (route.kind === 'choice' && route.options.every((option) => typeof option === 'string'));
}

function isUnboundedModelText(source: AiDecisionStep, field: string): boolean {
  const schema = outputFieldSchema(source, field);
  if (!schema) return field === 'conclusion' && !hasOutputFieldDefinition(source, field);
  return schema.type === 'string' && !Object.hasOwn(schema, 'enum');
}

function canDriveActionInput(
  source: AiDecisionStep,
  field: string,
  targetPortContract: ContractTypeName | undefined,
  targetInputType: CapabilityParamInputType | undefined,
): boolean {
  if (targetInputType && targetInputType !== 'text') return isStringChoiceOutput(source, field);
  if (targetPortContract === 'TextArtifact') {
    return isUnboundedModelText(source, field) || isStringChoiceOutput(source, field);
  }
  if (targetInputType) return isProducedWithoutLlm(source, field) && isStringChoiceOutput(source, field);
  return isProducedWithoutLlm(source, field);
}

export function validateWorkflowReferences(
  ir: WorkflowIR,
  byId: Map<string, Step>,
): ContractValidationIssue[] {
  const refs = ir.steps.flatMap((step): Array<{
    reference: string;
    usedByBranch: boolean;
    targetStepId?: string;
    targetPort?: string;
    targetPortContract?: ContractTypeName;
    targetInputType?: CapabilityParamInputType;
  }> => {
    if (step.type === 'if') {
      return conditionReferencePaths(step.condition)
        .map((reference) => ({ reference, usedByBranch: true }));
    }
    if (step.type === 'action') {
      const capability = resolveCapability(step.connector, step.action);
      const parameterRefs = Object.entries(step.params ?? {}).flatMap(([port, value]) =>
        referencePaths(value).map((reference) => ({
          reference,
          usedByBranch: false,
          targetStepId: step.id,
          targetPort: port,
          targetPortContract: capability?.io?.inputs?.[port],
          targetInputType: capability?.params.find((parameter) => parameter.name === port)?.inputType,
        })),
      );
      const bindingRefs = Object.entries(step.bindings ?? {})
        .filter(([, binding]) => binding.from !== 'trigger')
        .map(([port, binding]) => ({
          reference: binding.from + '.' + binding.output,
          usedByBranch: false,
          targetStepId: step.id,
          targetPort: port,
          targetPortContract: capability?.io?.inputs?.[port],
          targetInputType: capability?.params.find((parameter) => parameter.name === port)?.inputType,
        }));
      return [...parameterRefs, ...bindingRefs];
    }
    return [];
  });
  const issues: ContractValidationIssue[] = [];
  const reportedReferences = new Set<string>();
  for (const { reference, usedByBranch, targetStepId, targetPort, targetPortContract, targetInputType } of refs) {
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
    if (usedByBranch && !isProducedWithoutLlm(source, field)) {
      const issueKey = source.id + ':' + field + ':branch';
      if (!reportedReferences.has(issueKey)) {
        reportedReferences.add(issueKey);
        issues.push({
          code: 'invalid_workflow_schema',
          stepId: source.id,
          message: source.id + '.' + field + '는 if 분기에 사용되므로 boolean 또는 호스트가 고정 적용하거나 Jev가 선택할 수 있는 255개 이하의 string/number enum으로 선언해야 합니다.',
        });
      }
    }
    if (targetStepId && targetPort && !canDriveActionInput(source, field, targetPortContract, targetInputType)) {
      const issueKey = source.id + ':' + field + ':action:' + targetStepId + ':' + targetPort;
      if (reportedReferences.has(issueKey)) continue;
      reportedReferences.add(issueKey);
      issues.push({
        code: 'invalid_workflow_schema',
        stepId: source.id,
        message: source.id + '.' + field + ' 출력은 ' + targetStepId + '.' + targetPort + ' 입력 계약과 호환되지 않습니다. 자유형 문자열은 TextArtifact에만 연결하고, 식별자 입력은 문자열 enum으로 제한해야 합니다.',
      });
    }
  }
  return issues;
}
