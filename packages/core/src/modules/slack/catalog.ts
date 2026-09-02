import type { ConnectorCapability } from '../../catalog/capability-types.js';
import type { ConnectorCatalogEntry } from '../../catalog/connector-types.js';

export const SLACK_CAPABILITIES: ConnectorCapability[] = [
  {
    id: 'slack.channels.list',
    connector: 'slack',
    kind: 'read',
    label: 'Slack 채널 목록',
    description: '봇이 접근 가능한 채널 목록 조회',
    sideEffect: 'NONE',
    params: [],
    io: { inputs: {}, outputs: { channels: 'TableArtifact' } },
  },
  {
    id: 'slack.messages.search',
    connector: 'slack',
    kind: 'read',
    label: 'Slack 메시지 검색',
    description: '워크스페이스 메시지 검색',
    sideEffect: 'NONE',
    params: [
      { name: 'query', label: '검색어', question: '어떤 메시지를 찾을까요?', required: true },
      { name: 'limit', label: '개수', question: '몇 건까지 볼까요?', required: false },
    ],
    io: { inputs: {}, outputs: { hits: 'TableArtifact' } },
  },
  {
    id: 'slack.messages.read',
    connector: 'slack',
    kind: 'read',
    label: 'Slack 채널 읽기',
    description: '채널 최근 메시지 읽기',
    sideEffect: 'NONE',
    params: [
      { name: 'channel', label: 'Slack 채널', question: '어떤 채널을 읽을까요?', required: true, inputType: 'slack_channel', placeholder: '#채널명 또는 채널 ID' },
      { name: 'limit', label: '개수', question: '몇 건까지 볼까요?', required: false },
    ],
    io: { inputs: {}, outputs: { messages: 'TableArtifact' } },
  },
  {
    id: 'slack.message.send',
    connector: 'slack',
    kind: 'write',
    label: 'Slack 메시지',
    description: 'Slack 채널에 메시지 전송',
    sideEffect: 'EXTERNAL',
    notification: true,
    params: [
      { name: 'channel', label: 'Slack 채널', question: 'Slack 채널은 어디인가요?', required: true, inputType: 'slack_channel', placeholder: '#채널명 또는 채널 ID', displayInSummary: true, displayInApproval: true },
      { name: 'text', label: '메시지', question: '무슨 내용을 보낼까요?', required: true },
    ],
    io: { inputs: { text: 'TextArtifact' }, outputs: { message: 'SlackMessageRef' } },
  },
  {
    id: 'slack.new_message',
    connector: 'slack',
    kind: 'trigger',
    label: 'Slack 새 메시지',
    description: 'Slack 채널 새 메시지 도착 시 업무 시작',
    params: [{ name: 'channel', label: 'Slack 채널', question: '어떤 Slack 채널을 감시할까요?', required: true, inputType: 'slack_channel', placeholder: '#채널명 또는 채널 ID' }],
    io: { inputs: {}, outputs: { message: 'SlackMessageRef' } },
  },
];

export const SLACK_CATALOG: ConnectorCatalogEntry = {
  id: 'slack',
  label: 'Slack',
  description: 'Bot Token으로 메시지 읽기·전송',
  connectable: true,
  alwaysReal: false,
  runtimeAvailable: true,
  connectionKind: 'token',
  emoji: '💬',
};
