import { AxContextUpdateConfirmationSchema, type AxCommand, type AxCommandResult } from '../schema.js';
import { AGENT_COMMAND_CONTEXT } from '../access.js';
import { hostFacingMessage } from './result.js';
import { applyJevCommandInputValuesToCommand } from './jev-action-catalog.js';
import {
  executeChatCommand,
  workflowUpdateSuccessMessage,
  type CommandChatLoopContext,
} from './loop-shared.js';

/** Deterministic reply for a host-confirmed mutation; the result carries the executed command name. */
function confirmedMutationReply(result: AxCommandResult): string {
  if (result.status === 'ok' && result.command === 'workflow.delete') return '현재 workflow를 삭제했습니다.';
  if (result.status === 'ok' && result.command === 'workflow.update') return workflowUpdateSuccessMessage(result);
  if (result.command === 'workflow.run') return hostFacingMessage(result, '워크플로우 실행 요청을 처리하지 못했습니다.');
  return hostFacingMessage(result, '확인한 변경을 적용하지 못했습니다.');
}

async function commitJob({ options, signal, publishResult }: CommandChatLoopContext): Promise<string> {
  const result = await executeChatCommand(options, { name: 'job.commit', args: {} }, {
    executionContext: AGENT_COMMAND_CONTEXT,
    workspaceSessionId: options.workspaceSessionId,
    allowJobCommit: true,
    jobCommitConfirmationToken: options.jobCommitConfirmationToken,
    abortSignal: signal,
  });
  signal.throwIfAborted();
  return hostFacingMessage(publishResult('job.commit', result), '업무를 저장하지 못했습니다.');
}

async function commitMutation({ options, session, signal, publishResult }: CommandChatLoopContext): Promise<string> {
  // The host stored the exact proposed mutation; the agent cannot supply or change it here.
  const result = await executeChatCommand(options, { name: 'mutation.commit', args: {} }, {
    executionContext: AGENT_COMMAND_CONTEXT,
    workspaceSessionId: options.workspaceSessionId,
    currentWorkflowId: session.workflowId,
    mutationConfirmationToken: options.mutationConfirmationToken,
    abortSignal: signal,
  });
  signal.throwIfAborted();
  return confirmedMutationReply(publishResult(result.command, result));
}

async function saveConfirmedContext({ options, signal, publishResult }: CommandChatLoopContext): Promise<string> {
  const parsed = AxContextUpdateConfirmationSchema.safeParse(options.contextUpdateConfirmation);
  if (!parsed.success) return '저장 확인 데이터가 올바르지 않아 아무 내용도 저장하지 않았습니다.';
  const confirmation = parsed.data;
  if (confirmation.scope === 'workflow'
    && confirmation.workflowId !== options.currentWorkflowId?.trim()) {
    return '확인한 workflow가 현재 선택된 workflow와 달라 저장하지 않았습니다. 해당 workflow에서 다시 확인해 주세요.';
  }
  const command: AxCommand = {
    name: 'context.update',
    args: {
      scope: confirmation.scope,
      set: { [confirmation.key]: confirmation.value },
      confirmed: true,
    },
  };
  const result = await executeChatCommand(options, command, {
    executionContext: AGENT_COMMAND_CONTEXT,
    workspaceSessionId: options.workspaceSessionId,
    currentWorkflowId: confirmation.workflowId ?? options.currentWorkflowId,
    allowContextUpdate: true,
    abortSignal: signal,
  });
  signal.throwIfAborted();
  return hostFacingMessage(publishResult('context.update', result), '기억을 저장하지 못했습니다.');
}

function pendingCommandFallback(command: AxCommand, result: AxCommandResult): string {
  switch (command.name) {
    case 'workflow.create':
      return result.status === 'ok' ? '수동 workflow를 저장했습니다. 자동 실행은 활성화되지 않았습니다.' : 'workflow를 저장하지 못했습니다.';
    case 'job.propose':
      return result.status === 'ok' ? '업무 초안을 준비했습니다. 검토 후 확인해 주세요.' : '업무 초안을 처리하지 못했습니다.';
    case 'workflow.update':
      return result.status === 'ok' ? workflowUpdateSuccessMessage(result) : 'workflow를 수정하지 못했습니다.';
    default:
      return result.status === 'queued' || result.status === 'ok'
        ? '일회 실행을 큐에 등록했습니다. 실행 상태에서 진행 상황을 확인해 주세요.'
        : '일회 실행을 처리하지 못했습니다.';
  }
}

async function continuePendingCommand({ options, session, signal, publishResult }: CommandChatLoopContext): Promise<string> {
  const command = applyJevCommandInputValuesToCommand(
    options.pendingCommand!,
    options.commandInputValues ?? [],
  );
  if (!command) return '입력 대기 중인 실행안을 확인하지 못해 아무 작업도 실행하지 않았습니다. 처음 요청부터 다시 진행해 주세요.';
  const result = await executeChatCommand(options, command, {
    executionContext: AGENT_COMMAND_CONTEXT,
    userMessage: options.decisionMessage ?? options.userMessage,
    workspaceSessionId: options.workspaceSessionId,
    currentWorkflowId: session.workflowId,
    abortSignal: signal,
    designToolContext: options.designToolContext,
    designToolContextFactory: options.designToolContextFactory,
  });
  signal.throwIfAborted();
  const resultForLoop = publishResult(command.name, result, command);
  return hostFacingMessage(resultForLoop, pendingCommandFallback(command, resultForLoop));
}

/**
 * Turns the host already bound to an exact, host-rendered confirmation or pending
 * input. They never consult Jev or the model. Returns undefined for ordinary turns.
 */
export function runHostConfirmedTurn(context: CommandChatLoopContext): Promise<string> | undefined {
  const { options } = context;
  if (options.allowJobCommit) return commitJob(context);
  if (options.mutationConfirmationToken) return commitMutation(context);
  if (options.contextUpdateConfirmation) return saveConfirmedContext(context);
  if (options.pendingCommand) return continuePendingCommand(context);
  return undefined;
}
