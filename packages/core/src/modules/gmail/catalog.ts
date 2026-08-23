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
    description: '조건으로 메일 검색',
    sideEffect: 'NONE',
    params: [{ name: 'query', label: '검색어', question: '어떤 조건으로 메일을 찾을까요?', required: false }],
  },
  {
    id: 'gmail.draft.create',
    connector: 'gmail',
    kind: 'write',
    label: '메일 초안',
    description: '메일 초안 작성',
    sideEffect: 'REVERSIBLE',
    params: [
      { name: 'to', label: '수신자', question: '초안을 누구에게 보낼까요?', required: true },
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
    params: [
      { name: 'to', label: '수신자', question: '메일을 누구에게 보낼까요?', required: true },
      { name: 'subject', label: '제목', question: '메일 제목은요?', required: false },
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
