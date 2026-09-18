import {
  AxWorkflowCreateArgsSchema,
  AxWorkflowDeleteArgsSchema,
  AxWorkflowUpdateArgsSchema,
  type AxCommand,
  type AxCommandIssue,
} from '../schema.js';
import {
  parseWorkflowIR,
  validateWorkflowIR,
  type WorkflowIR,
} from '../../../../workflow/schema.js';
import type { ContractValidationIssue } from '../../../../workflow/contract-validator.js';
import type { WorkflowStore } from '../../../../persistence/workflow-store.js';
import type { AxWorkflowCommandResult } from './contract.js';
import {
  applyWorkflowField,
  candidateFromCreateCommand,
  normalizeStepInput,
} from './steps.js';
import {
  issue,
  mapContractIssue,
  statusForValidation,
} from './validation.js';

export function createWorkflow(store: WorkflowStore, command: AxCommand): AxWorkflowCommandResult {
  const candidate = candidateFromCreateCommand(command, AxWorkflowCreateArgsSchema);
  if (!candidate.ok) return candidate.result;
  return persistCandidate(store, candidate.value, 'created');
}

export function updateWorkflow(store: WorkflowStore, command: AxCommand): AxWorkflowCommandResult {
  const parsed = AxWorkflowUpdateArgsSchema.safeParse(command.args);
  if (!parsed.success) {
    return ['invalid', undefined, [issue('invalid_arguments', parsed.error.message)]];
  }

  const current = store.getWorkflow(parsed.data.workflowId);
  if (!current) {
    return [
      'not_found',
      undefined,
      [issue('workflow_not_found', `workflow를 찾을 수 없습니다: ${parsed.data.workflowId}`, 'workflowId')],
    ];
  }
  if (current.version !== parsed.data.baseVersion) {
    return [
      'conflict',
      { currentVersion: current.version },
      [issue('stale_workflow_version', `workflow가 ${current.version} 버전으로 변경되었습니다. 최신 버전을 다시 조회해야 합니다.`, 'baseVersion')],
    ];
  }

  const next: WorkflowIR = {
    ...current,
    steps: [...current.steps],
    assumptions: [...current.assumptions],
    sideEffects: { ...current.sideEffects },
  };
  const operationIssues: AxCommandIssue[] = [];

  for (const operation of parsed.data.operations) {
    if (operation.op === 'set') {
      const applied = applyWorkflowField(next, operation.path, operation.value);
      if (!applied.ok) operationIssues.push(applied.issue);
      continue;
    }
    if (operation.op === 'remove_step') {
      const index = next.steps.findIndex((step) => step.id === operation.stepId);
      if (index < 0) {
        operationIssues.push(issue('step_not_found', `step을 찾을 수 없습니다: ${operation.stepId}`, `steps.${operation.stepId}`));
        continue;
      }
      next.steps.splice(index, 1);
      delete next.sideEffects[operation.stepId];
      continue;
    }

    const normalized = normalizeStepInput(operation.step);
    if (!normalized.ok) {
      operationIssues.push(...normalized.issues);
      continue;
    }
    const index = next.steps.findIndex((step) => step.id === normalized.value.id);
    if (index < 0) next.steps.push(normalized.value);
    else next.steps[index] = normalized.value;
    if (normalized.value.type === 'action') next.sideEffects[normalized.value.id] = normalized.value.sideEffect;
    else delete next.sideEffects[normalized.value.id];
  }

  if (operationIssues.length > 0) return ['invalid', undefined, operationIssues];
  return persistCandidate(store, next, 'updated');
}

export async function deleteWorkflow(
  store: WorkflowStore,
  command: AxCommand,
  removeWorkflow?: (workflowId: string) => Promise<void> | void,
): Promise<AxWorkflowCommandResult> {
  const parsed = AxWorkflowDeleteArgsSchema.safeParse(command.args);
  if (!parsed.success) {
    return ['invalid', undefined, [issue('invalid_arguments', parsed.error.message)]];
  }
  const current = store.getWorkflow(parsed.data.workflowId);
  if (!current) {
    return ['not_found', undefined, [issue('workflow_not_found', `workflow를 찾을 수 없습니다: ${parsed.data.workflowId}`, 'workflowId')]];
  }
  if (current.version !== parsed.data.baseVersion) {
    return ['conflict', { currentVersion: current.version }, [issue('stale_workflow_version', '최신 workflow 버전과 일치하지 않습니다.', 'baseVersion')]];
  }
  try {
    await removeWorkflow?.(parsed.data.workflowId);
    const deleted = store.deleteWorkflow(parsed.data.workflowId);
    return deleted
      ? ['ok', { workflowId: parsed.data.workflowId, deleted: true }]
      : ['not_found', undefined, [issue('workflow_not_found', `workflow를 찾을 수 없습니다: ${parsed.data.workflowId}`, 'workflowId')]];
  } catch (error) {
    return ['error', undefined, [issue(
      'workflow_delete_failed',
      error instanceof Error ? error.message : String(error),
      'workflowId',
    )]];
  }
}

function persistCandidate(
  store: WorkflowStore,
  candidate: WorkflowIR,
  operation: 'created' | 'updated',
): AxWorkflowCommandResult {
  const parsed = validateWorkflowIR(candidate);
  if (!parsed.ok) return ['invalid', undefined, [issue('invalid_workflow_schema', parsed.error)]];
  try {
    const saved = store.saveWorkflow(parseWorkflowIR(parsed.value));
    const workflow = store.getWorkflow(saved.workflowId, saved.version);
    return ['ok', { operation, workflowId: saved.workflowId, version: saved.version, workflow }];
  } catch (error) {
    const contractIssues = (error as { issues?: ContractValidationIssue[] }).issues;
    if (Array.isArray(contractIssues)) {
      const issues = contractIssues.map(mapContractIssue);
      return [statusForValidation(contractIssues), { saved: false }, issues];
    }
    return ['error', undefined, [issue('workflow_persist_failed', error instanceof Error ? error.message : String(error))]];
  }
}
