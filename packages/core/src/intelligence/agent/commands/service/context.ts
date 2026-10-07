import {
  AxContextUpdateArgsSchema,
  AxUiPresentArgsSchema,
} from '../schema.js';
import type {
  AxCommand,
  AxCommandIssue,
  AxCommandResult,
} from '../schema.js';
import { issue } from '../contract.js';
import type {
  AxCommandExecuteOptions,
  AxCommandServiceState,
} from './contracts.js';

type CommandResultTuple = [
  AxCommandResult['status'],
  unknown,
  AxCommandIssue[]?,
];

export function presentUi(command: AxCommand): CommandResultTuple {
  const parsed = AxUiPresentArgsSchema.safeParse(command.args);
  if (!parsed.success) {
    return ['invalid', undefined, [issue('invalid_presentation', parsed.error.message)]];
  }
  return ['ok', { presentation: parsed.data }];
}

export function updateContext(
  state: AxCommandServiceState,
  command: AxCommand,
  options: AxCommandExecuteOptions,
): CommandResultTuple {
  const parsed = AxContextUpdateArgsSchema.safeParse(command.args);
  if (!parsed.success) {
    return ['invalid', undefined, [issue('invalid_context_update', parsed.error.message)]];
  }
  if (!options.allowContextUpdate || parsed.data.confirmed !== true) {
    return [
      'needs_input',
      undefined,
      [issue('context_confirmation_required', '기억해 둘 내용은 확인 카드에서 "저장"을 눌러야 저장됩니다.')],
    ];
  }

  if (parsed.data.scope === 'session') {
    if (!options.workspaceSessionId?.trim()) {
      return ['invalid', undefined, [issue('workspace_session_required', '메모는 대화 안에서 요청해야 저장할 수 있습니다.')]];
    }
    const memo = state.store.updateWorkspaceChatMemo(options.workspaceSessionId.trim(), parsed.data);
    if (!memo) {
      return ['not_found', undefined, [issue('workspace_session_not_found', '현재 대화를 찾지 못했습니다.')]];
    }
    return ['ok', { scope: 'session', sessionId: options.workspaceSessionId.trim(), context: memo }];
  }

  if (!options.currentWorkflowId?.trim()) {
    return ['invalid', undefined, [issue('workflow_required', '업무 규칙을 저장하려면 현재 업무가 필요합니다.')]];
  }
  const policy = state.store.updateWorkflowPolicy(options.currentWorkflowId.trim(), parsed.data);
  if (!policy) {
    return ['not_found', undefined, [issue('workflow_not_found', '현재 업무를 찾을 수 없습니다.')]];
  }
  return ['ok', { scope: 'workflow', workflowId: options.currentWorkflowId.trim(), context: policy }];
}
