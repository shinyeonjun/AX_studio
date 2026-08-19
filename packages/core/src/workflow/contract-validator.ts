import { canSatisfyInput, mergeAvailableTypes } from '../contracts/compatibility.js';
import type { ContractTypeName } from '../contracts/capability-io.js';
import {
  actionInputTypes,
  actionOutputTypes,
  triggerOutputTypes,
} from '../catalog/capability-contracts.js';
import type { Step, WorkflowIR } from './schema.js';

export interface ContractValidationIssue {
  code: 'missing_input_contract' | 'unknown_action_contract';
  stepId?: string;
  message: string;
  expected?: ContractTypeName[];
  available?: ContractTypeName[];
}

function isConcreteParamValue(value: unknown): boolean {
  return typeof value === 'string' && value.trim().length > 0 && !value.includes('{{');
}

function actionHasConcreteInputs(step: Extract<Step, { type: 'action' }>): boolean {
  if (step.connector === 'document' && step.action === 'ingest') {
    return isConcreteParamValue(step.params?.path);
  }
  if (step.connector === 'slack' && step.action === 'message.send') {
    return isConcreteParamValue(step.params?.text);
  }
  if (step.connector === 'gmail' && (step.action === 'message.send' || step.action === 'draft.create')) {
    return isConcreteParamValue(step.params?.body);
  }
  return false;
}

function stepContractIssues(
  step: Step,
  available: ContractTypeName[],
): { issues: ContractValidationIssue[]; nextAvailable: ContractTypeName[] } {
  if (step.type === 'ai_decision') {
    return {
      issues: [],
      nextAvailable: mergeAvailableTypes(available, ['JsonArtifact', 'TextArtifact']),
    };
  }

  if (step.type !== 'action') {
    return { issues: [], nextAvailable: available };
  }

  const requiredInputs = actionInputTypes(step.connector, step.action);
  if (requiredInputs.length === 0) {
    return {
      issues: [],
      nextAvailable: mergeAvailableTypes(available, actionOutputTypes(step.connector, step.action)),
    };
  }

  if (actionHasConcreteInputs(step)) {
    return {
      issues: [],
      nextAvailable: mergeAvailableTypes(available, actionOutputTypes(step.connector, step.action)),
    };
  }

  const missing = requiredInputs.filter((input) => !canSatisfyInput(available, input));
  if (missing.length > 0) {
    return {
      issues: [
        {
          code: 'missing_input_contract',
          stepId: step.id,
          message: `${step.connector}.${step.action} 단계에 필요한 데이터 계약을 이전 단계나 트리거가 제공하지 않습니다.`,
          expected: missing,
          available,
        },
      ],
      nextAvailable: available,
    };
  }

  return {
    issues: [],
    nextAvailable: mergeAvailableTypes(available, actionOutputTypes(step.connector, step.action)),
  };
}

export function validateWorkflowContracts(ir: WorkflowIR): ContractValidationIssue[] {
  const issues: ContractValidationIssue[] = [];
  let available = triggerOutputTypes(ir.trigger?.type);

  if (ir.trigger?.type === 'manual' && ir.inputs?.includes('filePath')) {
    available = mergeAvailableTypes(available, ['FileRef', 'DocumentIngestInput']);
  }

  if (ir.trigger?.type === 'gmail.new_message') {
    available = mergeAvailableTypes(available, ['EmailMessageRef']);
  }

  if (ir.trigger?.type === 'slack.new_message') {
    available = mergeAvailableTypes(available, ['SlackMessageRef']);
  }

  for (const step of ir.steps) {
    const result = stepContractIssues(step, available);
    issues.push(...result.issues);
    available = result.nextAvailable;
  }

  return issues;
}

export function validateWorkflowContractsOrThrow(ir: WorkflowIR): void {
  const issues = validateWorkflowContracts(ir);
  if (issues.length === 0) return;
  const first = issues[0]!;
  const error = new Error(first.message) as Error & { code: string; issues: ContractValidationIssue[] };
  error.code = 'contract_validation_failed';
  error.issues = issues;
  throw error;
}
