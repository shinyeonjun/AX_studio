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
      [issue('context_confirmation_required', '컨텍스트를 저장하기 전에 host 확인 UI에서 사용자의 확인이 필요합니다.')],
    ];
  }

  if (parsed.data.scope === 'session') {
    if (!options.workspaceSessionId?.trim()) {
      return ['invalid', undefined, [issue('workspace_session_required', 'session memo를 저장하려면 현재 대화 세션이 필요합니다.')]];
    }
    const memo = state.store.updateWorkspaceChatMemo(options.workspaceSessionId.trim(), parsed.data);
    if (!memo) {
      return ['not_found', undefined, [issue('workspace_session_not_found', '현재 대화 세션을 찾을 수 없습니다.')]];
    }
    return ['ok', { scope: 'session', sessionId: options.workspaceSessionId.trim(), context: memo }];
  }

  if (!options.currentWorkflowId?.trim()) {
    return ['invalid', undefined, [issue('workflow_required', 'workflow policy를 저장하려면 현재 workflow가 필요합니다.')]];
  }
  const policy = state.store.updateWorkflowPolicy(options.currentWorkflowId.trim(), parsed.data);
  if (!policy) {
    return ['not_found', undefined, [issue('workflow_not_found', '현재 workflow를 찾을 수 없습니다.')]];
  }
  return ['ok', { scope: 'workflow', workflowId: options.currentWorkflowId.trim(), context: policy }];
}
