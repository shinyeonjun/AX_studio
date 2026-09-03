import {
  matchHttpEndpoint,
  type HttpEndpoint,
} from '../../../modules/http/connection.js';
import { resolveHttpRequestUrl } from '../../../modules/http/url-security.js';
import type { WorkflowStore } from '../../../store/workflow-store.js';
import type {
  AxInputRequest,
  AxInputRequestOption,
} from '../schema.js';
import type { ListSlackChannels } from './contract.js';

export function connectedIds(store: WorkflowStore): string[] {
  return store.getConnections().filter((entry) => entry.connected).map((entry) => entry.connector);
}

export function pickHttpEndpoint(
  endpoints: readonly HttpEndpoint[],
  path: string,
  connectionId?: string,
): { ok: true; endpoint: HttpEndpoint } | { ok: false; code: 'missing' | 'not_found' | 'ambiguous' | 'invalid_path' } {
  if (endpoints.length === 0) return { ok: false, code: 'missing' };
  const named = connectionId?.trim() ? matchHttpEndpoint(endpoints, connectionId) : undefined;
  if (connectionId?.trim()) {
    if (!named) return { ok: false, code: 'not_found' };
    return resolveHttpRequestUrl(named.baseUrl, path).ok
      ? { ok: true, endpoint: named }
      : { ok: false, code: 'invalid_path' };
  }
  if (endpoints.length === 1) {
    return resolveHttpRequestUrl(endpoints[0]!.baseUrl, path).ok
      ? { ok: true, endpoint: endpoints[0]! }
      : { ok: false, code: 'invalid_path' };
  }
  return { ok: false, code: 'ambiguous' };
}

export function httpConnectionInput(
  endpoints: readonly HttpEndpoint[],
  id = 'job-http-connection',
): AxInputRequest {
  return {
    id,
    label: 'HTTP 연결',
    type: 'text',
    required: true,
    reason: '조회에 사용할 HTTP 연결을 선택해 주세요.',
    options: endpoints.map((endpoint): AxInputRequestOption => ({
      value: endpoint.id,
      label: endpoint.label || endpoint.id,
    })),
  };
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function slackChannelOptions(value: unknown): AxInputRequestOption[] {
  const envelope = asRecord(value);
  const payload = asRecord(envelope?.data) ?? envelope;
  const channels = Array.isArray(payload?.channels) ? payload.channels : [];
  const seen = new Set<string>();

  return channels.flatMap((entry): AxInputRequestOption[] => {
    const channel = asRecord(entry);
    const id = typeof channel?.id === 'string' ? channel.id.trim() : '';
    if (!id || seen.has(id)) return [];
    seen.add(id);
    const name = typeof channel?.name === 'string' ? channel.name.trim() : '';
    const label = name ? `${channel?.isPrivate === true ? '비공개 · ' : ''}#${name}` : id;
    const memberCount = typeof channel?.numMembers === 'number' && Number.isFinite(channel.numMembers)
      ? `${channel.numMembers}명 참여`
      : undefined;
    return [{ value: id, label, ...(memberCount ? { description: memberCount } : {}) }];
  });
}

export async function slackChannelInput(
  listSlackChannels?: ListSlackChannels,
  id = 'job-slack-channel',
): Promise<AxInputRequest> {
  const fallback: AxInputRequest = {
    id,
    label: 'Slack 채널',
    type: 'slack_channel',
    required: true,
    placeholder: '#채널명 또는 채널 ID',
    reason: listSlackChannels
      ? 'Slack 채널 목록을 불러오지 못했습니다. 채널 이름 또는 ID를 입력해 주세요.'
      : '공유할 Slack 채널 이름 또는 ID를 입력해 주세요.',
  };
  if (!listSlackChannels) return fallback;

  try {
    const result = await listSlackChannels();
    if (!result.ok) return fallback;
    const options = slackChannelOptions(result.data);
    if (options.length === 0) return fallback;
    return {
      ...fallback,
      placeholder: 'Slack 채널을 선택해 주세요',
      reason: '공유할 Slack 채널을 선택해 주세요.',
      options,
    };
  } catch {
    return fallback;
  }
}
