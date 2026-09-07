import type { ConnectorCapability } from '../../catalog/capability-types.js';
import type { ConnectorCatalogEntry } from '../../catalog/connector-types.js';

export const SLACK_CAPABILITIES: ConnectorCapability[] = [
  {
    id: 'slack.channels.list',
    connector: 'slack',
    kind: 'read',
    label: 'Slack 채널 목록',
    description: '접근 가능한 채널 한 페이지 조회(기본/최대 200개). truncated=true이면 같은 limit과 nextCursor를 cursor로 전달해 계속 조회합니다. 선택적 nextCursor는 반환 metadata이며 필수 IO 포트가 아닙니다. total은 제공하지 않습니다. 이어 읽은 마지막 페이지도 completeness.status=partial입니다.',
    sideEffect: 'NONE',
    params: [
      { name: 'limit', label: '페이지 크기', question: '한 페이지에서 몇 개까지 볼까요? (최대 200)', required: false },
      { name: 'cursor', label: '다음 페이지', question: '이전 응답의 nextCursor는 무엇인가요?', required: false },
    ],
    io: { inputs: {}, outputs: { channels: 'TableArtifact', limit: 'JsonArtifact', truncated: 'JsonArtifact' } },
  },
  {
    id: 'slack.messages.search',
    connector: 'slack',
    kind: 'read',
    label: 'Slack 메시지 검색',
    description: 'search:read 사용자 토큰으로 메시지 한 페이지 검색(기본 20, 최대 50건). 같은 query/limit과 nextCursor→cursor 또는 nextPage→page로 계속 조회합니다. 기본은 cursor 방식이며 page와 cursor는 함께 사용하지 않습니다. page 방식의 제공자 최대 100페이지에 도달하면 paginationLimitReached=true입니다. nextCursor/nextPage/total/paginationLimitReached는 선택적 반환 metadata이며 필수 IO 포트가 아닙니다. 이어 읽은 마지막 페이지도 completeness.status=partial입니다.',
    sideEffect: 'NONE',
    params: [
      { name: 'query', label: '검색어', question: '어떤 메시지를 찾을까요?', required: true },
      { name: 'limit', label: '개수', question: '몇 건까지 볼까요?', required: false },
      { name: 'cursor', label: '다음 페이지 커서', question: '이전 응답의 nextCursor는 무엇인가요?', required: false },
      { name: 'page', label: '페이지 번호', question: '이전 응답의 nextPage는 무엇인가요? (1~100, cursor와 동시 사용 불가)', required: false },
    ],
    io: { inputs: {}, outputs: { hits: 'TableArtifact', matches: 'TableArtifact', limit: 'JsonArtifact',
      truncated: 'JsonArtifact', page: 'JsonArtifact' } },
  },
  {
    id: 'slack.messages.read',
    connector: 'slack',
    kind: 'read',
    label: 'Slack 채널 읽기',
    description: '채널 메시지 한 페이지 읽기(기본 20, 최대 50건). 필터링된 빈 페이지도 truncated=true일 수 있습니다. 같은 channel/limit과 nextCursor→cursor, nextLatest→latest로 계속 조회합니다. nextCursor/nextLatest는 선택적 반환 metadata이며 필수 IO 포트가 아닙니다. total은 제공하지 않습니다. 이어 읽은 마지막 페이지도 completeness.status=partial입니다.',
    sideEffect: 'NONE',
    params: [
      { name: 'channel', label: 'Slack 채널', question: '어떤 채널을 읽을까요?', required: true, inputType: 'slack_channel', placeholder: '#채널명 또는 채널 ID' },
      { name: 'limit', label: '개수', question: '몇 건까지 볼까요?', required: false },
      { name: 'cursor', label: '다음 페이지', question: '이전 응답의 nextCursor는 무엇인가요?', required: false },
      { name: 'latest', label: '이전 시점', question: '이전 응답의 nextLatest는 무엇인가요?', required: false },
    ],
    io: { inputs: {}, outputs: { messages: 'TableArtifact', channelId: 'TextArtifact', limit: 'JsonArtifact',
      truncated: 'JsonArtifact' } },
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
