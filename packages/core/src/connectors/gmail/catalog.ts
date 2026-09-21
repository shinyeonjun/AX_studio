import type { ConnectorCapability } from '../../catalog/capability-types.js';
import type { ConnectorCatalogEntry } from '../../catalog/connector-types.js';

export const GMAIL_CAPABILITIES: ConnectorCapability[] = [
  {
    id: 'gmail.messages.read',
    connector: 'gmail',
    kind: 'read',
    label: '메일 읽기',
    description: '메일 본문·헤더 읽기',
    sideEffect: 'NONE',
    params: [{ name: 'messageId', label: '메일 ID', question: '어떤 메일을 읽을까요?', required: false }],
    io: { inputs: { message: 'EmailMessageRef' }, outputs: { body: 'TextArtifact' } },
  },
  {
    id: 'gmail.messages.search',
    connector: 'gmail',
    kind: 'read',
    label: '메일 검색',
    description: '조건으로 메일 한 페이지 검색(기본 10, 최대 50건). includeMetadata=true이면 본문 없이 From/Subject/Date 헤더만 추가 조회합니다. truncated=true이면 같은 query/limit/includeMetadata와 nextPageToken을 pageToken으로 전달해 계속 조회합니다. 선택적 nextPageToken/total/resultSizeEstimate/totalIsEstimate는 반환 metadata이며 필수 IO 포트가 아닙니다. total/resultSizeEstimate는 Gmail의 추정치입니다. completeness.status는 전체 검색 결과 기준이며 이어 읽은 마지막 페이지도 partial입니다.',
    sideEffect: 'NONE',
    params: [
      { name: 'query', label: '검색어', question: '어떤 조건으로 메일을 찾을까요?', required: false },
      { name: 'limit', label: '페이지 크기', question: '한 페이지에서 몇 건까지 볼까요? (최대 50)', required: false },
      { name: 'pageToken', label: '다음 페이지', question: '이전 응답의 nextPageToken은 무엇인가요?', required: false },
      { name: 'includeMetadata', label: '헤더 포함', question: '본문 없이 보낸 사람·제목·날짜 헤더도 가져올까요?', required: false },
    ],
    io: { inputs: {}, outputs: {
      messages: 'TableArtifact', hits: 'TableArtifact', limit: 'JsonArtifact', truncated: 'JsonArtifact',
    } },
  },
  {
    id: 'gmail.draft.create',
    connector: 'gmail',
    kind: 'write',
    label: '메일 초안',
    description: '메일 초안 작성',
    sideEffect: 'REVERSIBLE',
    params: [
      { name: 'to', label: '수신자', question: '초안을 누구에게 보낼까요?', required: true, inputType: 'email', placeholder: 'name@example.com' },
      { name: 'subject', label: '제목', question: '메일 제목은요?', required: false },
      { name: 'body', label: '본문', question: '메일 내용은요?', required: true },
    ],
    io: { inputs: { body: 'TextArtifact' }, outputs: { draft: 'EmailMessageRef' } },
  },
  {
    id: 'gmail.message.send',
    connector: 'gmail',
    kind: 'write',
    label: '메일 발송',
    description: '메일 발송',
    sideEffect: 'EXTERNAL_HIGH',
    notification: true,
    params: [
      { name: 'to', label: '수신자', question: '메일을 누구에게 보낼까요?', required: true, inputType: 'email', placeholder: 'name@example.com', displayInSummary: true, displayInApproval: true },
      { name: 'subject', label: '제목', question: '메일 제목은요?', required: false, displayInSummary: true },
      { name: 'body', label: '본문', question: '메일 내용은요?', required: true },
    ],
    io: { inputs: { body: 'TextArtifact' }, outputs: { message: 'EmailMessageRef' } },
  },
  {
    id: 'gmail.new_message',
    connector: 'gmail',
    kind: 'trigger',
    label: '새 메일',
    description: 'Gmail 새 메일 도착 시 업무 시작',
    params: [{ name: 'accountId', label: 'Gmail 계정', question: '어떤 Gmail 계정을 사용할까요?', required: true }],
    io: { inputs: {}, outputs: { message: 'EmailMessageRef' } },
  },
];

export const GMAIL_CATALOG: ConnectorCatalogEntry = {
  id: 'gmail',
  label: 'Gmail',
  description: 'OAuth로 메일 읽기·발송',
  connectable: true,
  alwaysReal: false,
  runtimeAvailable: true,
  connectionKind: 'oauth-loopback',
  emoji: '📧',
};
