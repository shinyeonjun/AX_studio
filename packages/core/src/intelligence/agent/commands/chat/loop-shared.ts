import type { ChatMessage } from '../../model/chat.js';
import { isRecoverableConnectorFailure } from '../../../../connectors/failure-kind.js';
import type { AxCommandChatOptions } from './contracts.js';
import type { AxCommand, AxCommandResult } from '../schema.js';
import { AGENT_COMMAND_CONTEXT } from '../access.js';
import { hostFacingMessage, type CommandChatSessionState } from './result.js';
import {
  httpEndpointSelectionMessage,
  httpEndpointSelectionPresentation,
  httpReadPathRequiredMessage,
} from './connection-selection/http-endpoint-selection.js';
import type { JevChatRouterFallbackReason } from './jev-router-contract.js';
import { deriveJevRequestFeatures } from './request-features.js';
import { appendAppLog } from '../../../../persistence/paths/app-log.js';
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

export function workflowUpdateSuccessMessage(result: AxCommandResult): string {
  const data = result.data;
  const reauthorizationRequired = data && typeof data === 'object'
    && (data as Record<string, unknown>).reauthorizationRequired === true;
  return reauthorizationRequired
    ? 'workflow를 수정했습니다. 실행 가능한 내용이 바뀌어 자동 실행을 중지했으니 다시 활성화하기 전에 검토해 주세요.'
    : 'workflow를 수정했습니다.';
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
      return '의미 판단 서비스를 확인할 수 없어 작업을 실행하지 않았습니다. 연결을 확인하고 다시 시도해 주세요.';
    case 'missing_context':
      return '요청을 처리할 연결·자료·대상이 부족합니다. 사용할 연결이나 대상을 지정해 주세요.';
    case 'http_endpoint_required':
      return '조회할 HTTP 연결을 하나 선택해 주세요.';
    case 'http_path_required':
      return httpReadPathRequiredMessage();
    case 'uncertain':
      return '요청을 확실히 판단하지 못해 작업을 실행하지 않았습니다. 원하는 결과와 대상을 조금 더 구체적으로 알려 주세요.';
    case 'unsupported':
      return '현재 연결된 기능 중 요청에 맞는 작업을 찾지 못했습니다. 연결된 도구나 요청 내용을 확인해 주세요.';
  }
}

export function missingReadValuesMessage(paths: readonly string[]): string {
  const names = [...new Set(paths.map((path) => path.slice(path.lastIndexOf('.') + 1)))];
  return `조회에 필요한 값(${names.join(', ')})을 요청에서 확인하지 못했습니다. 값을 알려 주세요.`;
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
