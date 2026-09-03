import {
  AxWorkflowRunArgsSchema,
  type AxCommand,
} from '../schema.js';
import type { WorkflowStore } from '../../../store/workflow-store.js';
import type { AxWorkflowCommandResult } from './contract.js';
import {
  issue,
  requiredTextInput,
  textArg,
  validateIR,
} from './validation.js';

export async function runWorkflow(
  store: WorkflowStore,
  runWorkflowCallback: ((workflowId: string) => Promise<unknown>) | undefined,
  command: AxCommand,
): Promise<AxWorkflowCommandResult> {
  const parsed = AxWorkflowRunArgsSchema.safeParse(command.args);
  if (!parsed.success) return ['invalid', undefined, [issue('invalid_arguments', parsed.error.message)]];
  if (!store.getWorkflow(parsed.data.workflowId)) {
    return ['not_found', undefined, [issue('workflow_not_found', `workflow를 찾을 수 없습니다: ${parsed.data.workflowId}`, 'args.workflowId')]];
  }
  if (!runWorkflowCallback) {
    return ['error', undefined, [issue('workflow_runner_unavailable', 'workflow 실행기가 연결되지 않았습니다.')]];
  }
  try {
    return ['ok', await runWorkflowCallback(parsed.data.workflowId)];
  } catch (error) {
    const code = typeof error === 'object' && error && 'code' in error ? String(error.code) : 'workflow_run_failed';
    return ['error', undefined, [issue(code, error instanceof Error ? error.message : String(error))]];
  }
}

export function inspectWorkflow(store: WorkflowStore, command: AxCommand): AxWorkflowCommandResult {
  const workflowId = textArg(command, 'workflowId');
  if (!workflowId) {
    return ['invalid', undefined, [issue(
      'missing_argument',
      'workflowId가 필요합니다.',
      'args.workflowId',
      [requiredTextInput('workflowId', '워크플로우', '확인할 워크플로우 id를 입력해 주세요.')],
    )]];
  }
  const workflow = store.getWorkflow(workflowId);
  if (!workflow) {
    return ['not_found', undefined, [issue('workflow_not_found', `workflow를 찾을 수 없습니다: ${workflowId}`, 'args.workflowId')]];
  }
  const validation = validateIR(store, workflow);
  return [validation.status, { workflow, validation: validation.data }, validation.issues];
}

export function validateWorkflow(store: WorkflowStore, command: AxCommand): AxWorkflowCommandResult {
  const workflowId = textArg(command, 'workflowId');
  if (!workflowId) {
    return ['invalid', undefined, [issue(
      'missing_argument',
      'workflowId가 필요합니다.',
      'args.workflowId',
      [requiredTextInput('workflowId', '워크플로우', '검증할 워크플로우 id를 입력해 주세요.')],
    )]];
  }
  const workflow = store.getWorkflow(workflowId);
  if (!workflow) {
    return ['not_found', undefined, [issue('workflow_not_found', `workflow를 찾을 수 없습니다: ${workflowId}`, 'args.workflowId')]];
  }
  const validation = validateIR(store, workflow);
  return [validation.status, validation.data, validation.issues];
}
