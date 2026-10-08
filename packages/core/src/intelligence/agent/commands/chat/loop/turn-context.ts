import { readValueNames } from '../shared/read-value-names.js';
import type { ChatMessage } from '../../../model/chat.js';
import { isRecoverableConnectorFailure } from '../../../../../connectors/failure-kind.js';
import type { AxCommandChatOptions } from './contracts.js';
import type { AxCommand, AxCommandResult } from '../../schema.js';
import { AGENT_COMMAND_CONTEXT } from '../../access.js';
import { hostFacingMessage, type CommandChatSessionState } from '../result/index.js';
import {
  httpEndpointSelectionMessage,
  httpEndpointSelectionPresentation,
  httpReadPathRequiredMessage,
} from './connection-selection/http-endpoint-selection.js';
import type { JevChatRouterFallbackReason } from '../routing/router-contract.js';
import { deriveJevRequestFeatures } from '../shared/request-features.js';
import { appendAppLog } from '../../../../../persistence/paths/app-log.js';
import type { ChatReadAuthorization } from './read-authorization.js';

export interface CommandChatLoopContext {
  readonly options: AxCommandChatOptions;
  readonly messages: ChatMessage[];
  readonly session: CommandChatSessionState;
  readonly signal: AbortSignal;
  readonly publishResult: (commandName: string, result: AxCommandResult, command?: AxCommand) => AxCommandResult;
}

export type ChatCommandExecutionOptions = NonNullable<Parameters<AxCommandChatOptions['commandService']['execute']>[1]>;

export function chatRequestContext(options: AxCommandChatOptions): { requestId?: string } {
  return options.requestId ? { requestId: options.requestId } : {};
}

export async function executeChatCommand(
  options: AxCommandChatOptions,
  command: AxCommand,
  executionOptions: ChatCommandExecutionOptions,
): Promise<AxCommandResult> {
  const startedAt = performance.now();
  let outcome: string = 'threw';
  try {
    const result = await options.commandService.execute(command, executionOptions);
    outcome = result.status;
    return result;
  } finally {
    appendAppLog('info', 'Chat command execution timing recorded.', {
      ...chatRequestContext(options),
      event: 'chat_command_execution_timing',
      command: command.name,
      outcome,
      durationMs: Math.round(performance.now() - startedAt),
    });
  }
}

/** Execute an agent command with the turn's session, workflow, and design-tool scope. */
export function executeScopedChatCommand(
  { options, session, signal }: CommandChatLoopContext,
  command: AxCommand,
  readAuthorization?: ChatReadAuthorization,
): Promise<AxCommandResult> {
  return executeChatCommand(options, command, {
    executionContext: AGENT_COMMAND_CONTEXT,
    userMessage: options.userMessage,
    workspaceSessionId: options.workspaceSessionId,
    currentWorkflowId: session.workflowId,
    abortSignal: signal,
    designToolContext: options.designToolContext,
    designToolContextFactory: options.designToolContextFactory,
    ...(readAuthorization ? { readAuthorization } : {}),
  });
}

export function readOperationIdentity(capabilityId: string, params: unknown): string | undefined {
  try {
    const serialized = JSON.stringify(params);
    return serialized === undefined ? undefined : `${capabilityId}\0${serialized}`;
  } catch {
    return undefined;
  }
}

/** A run that was accepted carries no message of its own; never word it as a failure. */
export function workflowRunReply(result: AxCommandResult): string {
  if (result.status === 'ok' || result.status === 'queued') {
    return '업무 실행을 시작했습니다. 결과는 끝나는 대로 이 대화에 표시됩니다.';
  }
  return hostFacingMessage(result, '업무를 실행하지 못했습니다.');
}

export const WORKFLOW_DELETED_REPLY = '업무를 삭제했습니다.';

export function workflowUpdateSuccessMessage(result: AxCommandResult): string {
  const data = result.data;
  const reauthorizationRequired = data && typeof data === 'object'
    && (data as Record<string, unknown>).reauthorizationRequired === true;
  return reauthorizationRequired
    ? '업무를 수정했습니다. 실행 내용이 바뀌어 자동 실행을 멈췄으니 다시 켜기 전에 검토해 주세요.'
    : '업무를 수정했습니다.';
}

export function isRecoverableReadFailure(
  result: AxCommandResult,
): result is AxCommandResult & { status: 'error' | 'not_found' } {
  if (result.status !== 'error' && result.status !== 'not_found') return false;
  if (result.issues.length === 0) return result.status === 'not_found';
  return result.issues.every((item) => item.failureKind !== undefined
    && isRecoverableConnectorFailure(item.failureKind));
}

export const PARTIAL_PREVIOUS_RESULT_NOTE = '참고: 이전 표는 전체 데이터 중 일부만 포함하고 있어, 위 계산은 표시된 행만 기준으로 한 값이며 전체 데이터의 합계·평균이 아닙니다.';

/** True when an answer computes over a previous table the host knows is partial. */
export function partialPreviousResultCalculation(options: AxCommandChatOptions): boolean {
  const table = options.previousReadResult;
  if (!table) return false;
  const partial = table.truncated === true || table.coverage?.hasMore === true
    || (table.completeness !== undefined && table.completeness.status !== 'complete');
  return partial && deriveJevRequestFeatures(options.userMessage).calculation_or_summary_cue === true;
}

export function jevFallbackMessage(reason: JevChatRouterFallbackReason): string {
  switch (reason) {
    case 'service_error':
      return '판단 엔진(Jev)에 연결하지 못해 작업을 실행하지 않았습니다. 설정 > 판단 엔진에서 연결 상태를 확인한 뒤 다시 시도해 주세요.';
    case 'missing_context':
      return '요청을 처리할 연결·자료·대상이 부족합니다. 사용할 연결이나 대상을 지정해 주세요.';
    case 'http_endpoint_required':
      return '자료를 가져올 연결을 하나 골라 주세요.';
    case 'http_path_required':
      return httpReadPathRequiredMessage();
    case 'uncertain':
      return '요청을 확실히 판단하지 못해 작업을 실행하지 않았습니다. 원하는 결과와 대상을 조금 더 구체적으로 알려 주세요.';
    case 'unsupported':
      return '지금 연결된 서비스로는 요청에 맞는 작업을 찾지 못했습니다. 설정에서 필요한 서비스를 연결하거나 요청을 조금 바꿔 주세요.';
  }
}

export function missingReadValuesMessage(paths: readonly string[]): string {
  return `조회에 필요한 값(${readValueNames(paths)})을 요청에서 찾지 못했습니다. 이 값을 넣어 다시 요청해 주세요.`;
}

export async function presentHttpEndpointSelection({ options, signal, publishResult }: CommandChatLoopContext): Promise<string> {
  const endpoints = options.httpEndpoints ?? [];
  const command: AxCommand = {
    name: 'ui.present',
    args: httpEndpointSelectionPresentation(endpoints),
  };
  const result = await executeChatCommand(options, command, {
    executionContext: AGENT_COMMAND_CONTEXT,
    userMessage: options.userMessage,
    workspaceSessionId: options.workspaceSessionId,
    abortSignal: signal,
  });
  signal.throwIfAborted();
  return hostFacingMessage(
    publishResult('ui.present', result),
    httpEndpointSelectionMessage(endpoints),
  );
}
