import type { AxCommand, AxCommandResult } from '../../schema.js';
import { explicitlyRequestsRawMetadata, renderCatalogMetadata } from '../metadata-output.js';
import { needsModelTransform } from './read-replies.js';

export function deterministicWorkflowListChatReply(
  command: AxCommand,
  result: AxCommandResult,
  userMessage: string,
): string | undefined {
  if (command.name !== 'workflow.list' || result.command !== 'workflow.list' || result.status !== 'ok') return undefined;
  if (needsModelTransform(userMessage)) return undefined;
  if (!result.data || typeof result.data !== 'object' || Array.isArray(result.data)) return undefined;
  const workflows = (result.data as { workflows?: unknown }).workflows;
  if (!Array.isArray(workflows)) return undefined;
  if (workflows.length === 0) return '저장된 업무가 없습니다.';
  if (!workflows.every((workflow) => workflow && typeof workflow === 'object' && !Array.isArray(workflow)
    && typeof workflow.id === 'string'
    && typeof workflow.name === 'string'
    && typeof workflow.active === 'boolean'
    && Number.isSafeInteger(workflow.latestVersion))) return undefined;

  return [
    `저장된 업무 (${workflows.length}개):`,
    ...workflows.map((workflow) => {
      const entry = workflow as { id: string; name: string; active: boolean; latestVersion: number };
      return `- ${JSON.stringify(entry.name)} — ${entry.active ? '자동 실행 중' : '꺼짐'}`;
    }),
  ].join('\n');
}

// Skip prose generation only for explicit catalog display; interpretation stays on the model path.
const DETERMINISTIC_METADATA_COMMANDS: ReadonlySet<AxCommand['name']> = new Set([
  'resource.list',
  'source.list',
  'source.files.list',
  'session.source.list',
  'capability.list',
  'capability.describe',
  'discovery.search',
  'discovery.describe',
]);
const METADATA_DISPLAY_INTENT = /(?:목록|리스트|보여|나열|그대로|원본|조회해|확인해|알려줘|찾아줘|검색해|\b(?:list|show|display|find|search|lookup)\b)/iu;

export function deterministicHttpConnectionListChatReply(
  command: AxCommand,
  result: AxCommandResult,
  userMessage: string,
): string | undefined {
  if (command.name !== 'http.list'
    || result.command !== command.name
    || result.status !== 'ok'
    || !METADATA_DISPLAY_INTENT.test(userMessage)
    || needsModelTransform(userMessage)
    || !result.data
    || typeof result.data !== 'object'
    || Array.isArray(result.data)) return undefined;

  const data = result.data as { connections?: unknown; count?: unknown; totalMatches?: unknown; truncated?: unknown };
  if (!Array.isArray(data.connections)
    || !data.connections.every((connection) => connection && typeof connection === 'object'
      && !Array.isArray(connection)
      && typeof connection.id === 'string'
      && typeof connection.label === 'string'
      && typeof connection.connected === 'boolean'
      && typeof connection.usable === 'boolean')) return undefined;
  if (data.connections.length === 0) {
    return typeof data.count === 'number' && data.count > 0
      ? '조건에 맞는 서비스 연결이 없습니다.'
      : '저장된 서비스 연결이 없습니다.';
  }

  const connections = data.connections as { id: string; label: string; connected: boolean; usable: boolean }[];
  const total = Number.isSafeInteger(data.totalMatches) ? data.totalMatches as number : connections.length;
  return [
    `저장된 서비스 연결 (${connections.length}/${total}개):`,
    ...connections.map((connection) =>
      `- ${JSON.stringify(connection.label)} — ${connection.usable ? '사용 가능' : connection.connected ? '로그인 정보 필요' : '연결 안 됨'}`),
    '저장된 설정만 확인했어요. 실제로 접속되는지는 확인하지 않았어요.',
    ...(data.truncated === true ? ['', '목록이 일부만 표시되었습니다.'] : []),
  ].join('\n');
}

export function deterministicMetadataChatReply(
  command: AxCommand,
  result: AxCommandResult,
  userMessage: string,
): string | undefined {
  if (!DETERMINISTIC_METADATA_COMMANDS.has(command.name)
    || result.command !== command.name
    || result.status !== 'ok'
    || result.data === undefined
    || needsModelTransform(userMessage)
    || !METADATA_DISPLAY_INTENT.test(userMessage)) return undefined;

  return renderCatalogMetadata(command, result.data, explicitlyRequestsRawMetadata(userMessage));
}
