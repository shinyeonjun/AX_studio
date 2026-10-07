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
import { validateWorkflowForPersistence, type ContractValidationIssue } from '../../../../workflow/contract-validator.js';
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

export interface WorkflowUpdatePreview {
  workflowId: string;
  current: WorkflowIR;
  next: WorkflowIR;
  executableChange: boolean;
}

/** Validates an update and computes the next definition without persisting anything. */
export function previewWorkflowUpdate(
  store: WorkflowStore,
  command: AxCommand,
): { ok: true; value: WorkflowUpdatePreview } | { ok: false; result: AxWorkflowCommandResult } {
  const parsed = AxWorkflowUpdateArgsSchema.safeParse(command.args);
  if (!parsed.success) {
    return { ok: false, result: ['invalid', undefined, [issue('invalid_arguments', parsed.error.message)]] };
  }

  const current = store.getWorkflow(parsed.data.workflowId);
  if (!current) {
    return { ok: false, result: [
      'not_found',
      undefined,
      [issue('workflow_not_found', '해당 업무를 찾지 못했어요. 이미 삭제되었는지 확인해 주세요.', 'workflowId')],
    ] };
  }
  if (current.version !== parsed.data.baseVersion) {
    return { ok: false, result: [
      'conflict',
      { currentVersion: current.version },
      [issue('stale_workflow_version', '그사이 업무가 바뀌었어요. 새로 고친 뒤 다시 시도해 주세요.', 'baseVersion')],
    ] };
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
        operationIssues.push(issue('step_not_found', '해당 단계를 찾지 못했어요.', `steps.${operation.stepId}`));
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

  if (operationIssues.length > 0) return { ok: false, result: ['invalid', undefined, operationIssues] };
  const executableChange = parsed.data.operations.some((operation) =>
    operation.op === 'upsert_step'
    || operation.op === 'remove_step'
    || (operation.op === 'set' && operation.path === 'trigger'));
  // Auto-send consent covered the previous executable definition only; any
  // executable change must be re-consented, whether or not the workflow is active.
  if (executableChange) next.allowExternalAuto = false;
  // Validate exactly as persistence will, so missing inputs surface before any confirmation card.
  const schema = validateWorkflowIR(next);
  if (!schema.ok) return { ok: false, result: ['invalid', undefined, [issue('invalid_workflow_schema', schema.error)]] };
  const contractIssues = validateWorkflowForPersistence(parseWorkflowIR(schema.value));
  if (contractIssues.length > 0) return { ok: false, result: contractValidationResult(contractIssues) };
  return { ok: true, value: { workflowId: parsed.data.workflowId, current, next, executableChange } };
}

export function updateWorkflow(store: WorkflowStore, command: AxCommand): AxWorkflowCommandResult {
  const preview = previewWorkflowUpdate(store, command);
  if (!preview.ok) return preview.result;
  const { workflowId, current, next, executableChange } = preview.value;
  const wasActive = store.isWorkflowActive(workflowId);

  const persisted = persistCandidate(store, next, 'updated');
  if (wasActive && executableChange && persisted[0] === 'ok') {
    store.setWorkflowActive(workflowId, false);
    const data = persisted[1] && typeof persisted[1] === 'object'
      ? { ...(persisted[1] as Record<string, unknown>), active: false, reauthorizationRequired: true }
      : { active: false, reauthorizationRequired: true };
    return [persisted[0], data, persisted[2]];
  }
  if (executableChange && current.allowExternalAuto && persisted[0] === 'ok') {
    const data = persisted[1] && typeof persisted[1] === 'object'
      ? { ...(persisted[1] as Record<string, unknown>), externalAutoReset: true }
      : { externalAutoReset: true };
    return [persisted[0], data, persisted[2]];
  }
  return persisted;
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
    return ['not_found', undefined, [issue('workflow_not_found', '해당 업무를 찾지 못했어요. 이미 삭제되었는지 확인해 주세요.', 'workflowId')]];
  }
  if (current.version !== parsed.data.baseVersion) {
    return ['conflict', { currentVersion: current.version }, [issue('stale_workflow_version', '그사이 업무가 바뀌었어요. 새로 고친 뒤 다시 시도해 주세요.', 'baseVersion')]];
  }
  if (!store.claimWorkflowDeletion(parsed.data.workflowId, parsed.data.baseVersion)) {
    const latest = store.getWorkflow(parsed.data.workflowId);
    if (!latest) {
      return ['not_found', undefined, [issue('workflow_not_found', '해당 업무를 찾지 못했어요. 이미 삭제되었는지 확인해 주세요.', 'workflowId')]];
    }
    if (latest.version !== parsed.data.baseVersion) {
      return ['conflict', { currentVersion: latest.version }, [issue('stale_workflow_version', '그사이 업무가 바뀌었어요. 새로 고친 뒤 다시 시도해 주세요.', 'baseVersion')]];
    }
    return ['conflict', { currentVersion: latest.version }, [issue('workflow_deletion_in_progress', '업무 삭제가 진행 중입니다. 잠시 후 다시 시도해 주세요.', 'workflowId')]];
  }
  try {
    await removeWorkflow?.(parsed.data.workflowId);
    const deleted = store.deleteWorkflow(parsed.data.workflowId);
    return deleted
      ? ['ok', { workflowId: parsed.data.workflowId, deleted: true }]
      : ['not_found', undefined, [issue('workflow_not_found', '해당 업무를 찾지 못했어요. 이미 삭제되었는지 확인해 주세요.', 'workflowId')]];
  } catch (error) {
    return ['error', undefined, [issue(
      'workflow_delete_failed',
      error instanceof Error ? error.message : String(error),
      'workflowId',
    )]];
  } finally {
    store.releaseWorkflowDeletion(parsed.data.workflowId);
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
    if ((error as { code?: unknown })?.code === 'workflow_deletion_in_progress') {
      return ['conflict', { saved: false }, [issue('workflow_deletion_in_progress', '업무 삭제가 진행 중이어서 수정할 수 없습니다. 잠시 후 다시 시도해 주세요.')]];
    }
    const contractIssues = (error as { issues?: ContractValidationIssue[] }).issues;
    if (Array.isArray(contractIssues)) return contractValidationResult(contractIssues);
    return ['error', undefined, [issue('workflow_persist_failed', error instanceof Error ? error.message : String(error))]];
  }
}

function contractValidationResult(contractIssues: readonly ContractValidationIssue[]): AxWorkflowCommandResult {
  const status = statusForValidation([...contractIssues]);
  const issues = contractIssues.map(mapContractIssue);
  if (status === 'needs_input' && issues.some((entry) => entry.inputRequests?.length)) {
    const inputIssues = issues.filter((entry) => entry.inputRequests?.length);
    return [status, { saved: false }, [...inputIssues, ...issues.filter((entry) => !entry.inputRequests?.length)]];
  }
  return [status, { saved: false }, issues];
}
