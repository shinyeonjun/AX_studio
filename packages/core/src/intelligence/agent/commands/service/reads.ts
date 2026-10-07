import { WorkspaceSourceError } from '../../../../persistence/workspace-source-service.js';
import { sourceManifestPage } from '../../source-manifest.js';
import type {
  AxCommand,
  AxCommandIssue,
  AxCommandResult,
} from '../schema.js';
import {
  AxSessionSourceListArgsSchema,
  AxSessionSourceReadArgsSchema,
} from '../schema.js';
import {
  boundedReadErrorDetails,
  issue,
} from '../contract.js';
import type {
  AxCommandReadContext,
  AxCommandReadTool,
} from '../read-gateway.js';
import type { AxCommandServiceState } from './contracts.js';

type ArgsSchema<T> = {
  safeParse: (value: unknown) =>
    | { success: true; data: T }
    | { success: false; error: { message: string } };
};

type CommandResultTuple = [
  AxCommandResult['status'],
  unknown,
  AxCommandIssue[]?,
];

export async function executeReadTool<T>(
  state: AxCommandServiceState,
  command: AxCommand,
  tool: AxCommandReadTool,
  argsSchema: ArgsSchema<T>,
  designToolContext?: AxCommandReadContext,
  designToolContextFactory?: () => AxCommandReadContext,
  abortSignal?: AbortSignal,
): Promise<CommandResultTuple> {
  const parsed = argsSchema.safeParse(command.args);
  if (!parsed.success) {
    return ['invalid', undefined, [issue('invalid_arguments', parsed.error.message)]];
  }
  const execution = await state.readGateway.execute(
    { tool, args: parsed.data as Record<string, unknown> },
    designToolContext ?? designToolContextFactory?.(),
    abortSignal,
  );
  if (execution.ok) return ['ok', execution.data];
  const error = execution.error ?? 'source_command_failed';
  const status = error === 'source_content_requires_local_ai' || execution.failureKind === 'host_policy'
    ? 'forbidden'
    : execution.failureKind === 'not_found' || error.endsWith('not_found')
      ? 'not_found'
      : 'error';
  return [
    status,
    undefined,
    [issue(
      error,
      'command ' + command.name + ' 실행 실패: ' + error,
      undefined,
      boundedReadErrorDetails(execution.errorDetails),
      undefined,
      execution.failureKind,
    )],
  ];
}

export function listSessionSources(
  state: AxCommandServiceState,
  command: AxCommand,
  sessionId: string | undefined,
): CommandResultTuple {
  const parsed = AxSessionSourceListArgsSchema.safeParse(command.args);
  if (!parsed.success) return ['invalid', undefined, [issue('invalid_arguments', parsed.error.message)]];
  if (!sessionId?.trim()) {
    return ['invalid', undefined, [issue('workspace_session_required', '대화 안에서 요청해 주세요.')]];
  }
  if (!state.options.workspaceSources) {
    return ['error', undefined, [issue('session_source_unavailable', '이 대화에 올린 자료를 지금 불러올 수 없습니다. 잠시 후 다시 시도해 주세요.')]];
  }
  return ['ok', { sessionId: sessionId.trim(),
    ...sourceManifestPage(state.options.workspaceSources.list(sessionId), parsed.data) }];
}

export function readSessionSource(
  state: AxCommandServiceState,
  command: AxCommand,
  sessionId: string | undefined,
): CommandResultTuple {
  const parsed = AxSessionSourceReadArgsSchema.safeParse(command.args);
  if (!parsed.success) return ['invalid', undefined, [issue('invalid_arguments', parsed.error.message)]];
  if (!sessionId?.trim()) {
    return ['invalid', undefined, [issue('workspace_session_required', '대화 안에서 요청해 주세요.')]];
  }
  if (!state.options.workspaceSources) {
    return ['error', undefined, [issue('session_source_unavailable', '이 대화에 올린 자료를 지금 불러올 수 없습니다. 잠시 후 다시 시도해 주세요.')]];
  }
  try {
    return ['ok', state.options.workspaceSources.read(sessionId, parsed.data.sourceId, parsed.data.maxChars)];
  } catch (error) {
    const code = error instanceof WorkspaceSourceError ? error.code : 'session_source_read_failed';
    const status: AxCommandResult['status'] = code === 'workspace_source_processing'
      ? 'needs_input'
      : code.endsWith('not_found')
        ? 'not_found'
        : 'error';
    return [status, undefined, [issue(code, '이 대화에 올린 자료를 읽을 수 없습니다.')]];
  }
}
