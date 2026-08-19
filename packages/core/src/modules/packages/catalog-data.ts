import type { ConnectorCapability } from '../../catalog/capability-types.js';
import type { ConnectorCatalogEntry, ConnectorId } from '../../catalog/connector-types.js';
import { CONNECTOR_IDS } from '../../catalog/connector-types.js';

/** Browser-safe catalog metadata (no connector implementations). */

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
      { name: 'body', label: '본문', question: '메일 내용은요?', required: false },
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
      { name: 'body', label: '본문', question: '메일 내용은요?', required: false },
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
  connectionKind: 'oauth-loopback',
  emoji: '📧',
};

export const SLACK_CAPABILITIES: ConnectorCapability[] = [
  {
    id: 'slack.message.send',
    connector: 'slack',
    kind: 'write',
    label: 'Slack 메시지',
    description: 'Slack 채널에 메시지 전송',
    sideEffect: 'EXTERNAL',
    params: [
      { name: 'channel', label: 'Slack 채널', question: 'Slack 채널은 어디인가요?', required: true },
      { name: 'text', label: '메시지', question: '무슨 내용을 보낼까요?', required: false },
    ],
    io: { inputs: { text: 'TextArtifact' }, outputs: { message: 'SlackMessageRef' } },
  },
  {
    id: 'slack.new_message',
    connector: 'slack',
    kind: 'trigger',
    label: 'Slack 새 메시지',
    description: 'Slack 채널 새 메시지 도착 시 업무 시작',
    params: [{ name: 'channel', label: 'Slack 채널', question: '어떤 Slack 채널을 감시할까요?', required: true }],
    io: { inputs: {}, outputs: { message: 'SlackMessageRef' } },
  },
];

export const SLACK_CATALOG: ConnectorCatalogEntry = {
  id: 'slack',
  label: 'Slack',
  description: 'Bot Token으로 메시지 전송',
  connectable: true,
  alwaysReal: false,
  connectionKind: 'token',
  emoji: '💬',
};

export const LOCAL_FOLDER_CAPABILITIES: ConnectorCapability[] = [
  {
    id: 'local_folder.new_file',
    connector: 'local_folder',
    kind: 'trigger',
    label: '새 파일',
    description: '연결 폴더에 새 파일이 생기면 업무 시작',
    params: [
      { name: 'folderId', label: '연결 폴더', question: '어떤 폴더를 감시할까요?', required: true },
      {
        name: 'extensions',
        label: '파일 형식',
        question: '어떤 확장자만 감시할까요? (예: .pdf,.docx)',
        required: false,
      },
    ],
    io: { inputs: {}, outputs: { file: 'FileRef' } },
  },
  {
    id: 'local_folder.list',
    connector: 'local_folder',
    kind: 'read',
    label: '폴더 목록',
    description: '연결 폴더의 파일 목록 조회',
    sideEffect: 'NONE',
    params: [{ name: 'folderId', label: '폴더', question: '어떤 연결 폴더를 볼까요?', required: false }],
  },
  {
    id: 'local_folder.read',
    connector: 'local_folder',
    kind: 'read',
    label: '파일 읽기',
    description: '연결 폴더의 파일 읽기',
    sideEffect: 'NONE',
    params: [
      { name: 'folderId', label: '폴더', question: '어떤 연결 폴더인가요?', required: false },
      { name: 'path', label: '파일 경로', question: '어떤 파일을 읽을까요?', required: true },
    ],
    io: { inputs: { file: 'FileRef' }, outputs: { file: 'FileRef' } },
  },
];

export const LOCAL_FOLDER_CATALOG: ConnectorCatalogEntry = {
  id: 'local_folder',
  label: '로컬 폴더',
  description: '내 PC 폴더를 문서·파일 소스로 연결 · 새 파일 트리거',
  connectable: true,
  alwaysReal: false,
  connectionKind: 'config',
  emoji: '📁',
};

export const DOCUMENT_CAPABILITIES: ConnectorCapability[] = [
  {
    id: 'document.ingest',
    connector: 'document',
    kind: 'read',
    label: '문서 읽기',
    description: 'Document Engine으로 문서 파싱',
    sideEffect: 'NONE',
    params: [{ name: 'path', label: '문서 경로', question: '어떤 문서를 읽을까요?', required: true }],
    io: { inputs: { source: 'DocumentIngestInput' }, outputs: { document: 'DocumentArtifact' } },
  },
  {
    id: 'document.getChunk',
    connector: 'document',
    kind: 'read',
    label: '문서 청크',
    description: '저장된 문서 청크 불러오기',
    sideEffect: 'NONE',
    params: [
      { name: 'documentId', label: '문서 ID', question: '어떤 문서인가요?', required: false },
      { name: 'chunkId', label: '청크 ID', question: '어떤 청크를 가져올까요?', required: true },
    ],
  },
  {
    id: 'document.getPage',
    connector: 'document',
    kind: 'read',
    label: '문서 페이지',
    description: '저장된 문서 페이지 불러오기',
    sideEffect: 'NONE',
    params: [
      { name: 'documentId', label: '문서 ID', question: '어떤 문서인가요?', required: false },
      { name: 'pageIndex', label: '페이지', question: '몇 페이지를 읽을까요?', required: true },
    ],
  },
  {
    id: 'document.search',
    connector: 'document',
    kind: 'read',
    label: '문서 검색',
    description: '문서 청크 검색',
    sideEffect: 'NONE',
    params: [
      { name: 'documentId', label: '문서 ID', question: '어떤 문서에서 찾을까요?', required: false },
      { name: 'query', label: '검색어', question: '무엇을 찾을까요?', required: true },
    ],
  },
  {
    id: 'document.html.render',
    connector: 'document',
    kind: 'write',
    label: 'HTML 생성',
    description: 'HTML 문서 렌더',
    sideEffect: 'REVERSIBLE',
    params: [{ name: 'template', label: '문서 양식', question: '어떤 문서 양식을 사용할까요?', required: true }],
  },
  {
    id: 'document.docx.fill',
    connector: 'document',
    kind: 'write',
    label: 'DOCX 작성',
    description: 'DOCX 양식 채우기',
    sideEffect: 'REVERSIBLE',
    params: [{ name: 'template', label: '문서 양식', question: '어떤 문서 양식을 사용할까요?', required: true }],
  },
  {
    id: 'document.pdf.generate',
    connector: 'document',
    kind: 'write',
    label: 'PDF 생성',
    description: 'PDF 문서 생성',
    sideEffect: 'REVERSIBLE',
    params: [{ name: 'template', label: '문서 양식', question: '어떤 문서 양식을 사용할까요?', required: true }],
  },
];

export const DOCUMENT_CATALOG: ConnectorCatalogEntry = {
  id: 'document',
  label: 'Document',
  description: 'HTML/DOCX/PDF 등 문서 읽기·생성',
  connectable: false,
  alwaysReal: true,
  connectionKind: 'builtin',
  emoji: '📄',
};

export const RDB_CAPABILITIES: ConnectorCapability[] = [
  {
    id: 'rdb.schema.describe',
    connector: 'rdb',
    kind: 'read',
    label: 'DB 스키마',
    description: '허용된 테이블 목록 조회',
    sideEffect: 'NONE',
    params: [],
  },
  {
    id: 'rdb.query.read',
    connector: 'rdb',
    kind: 'read',
    label: 'DB 조회',
    description: '허용된 테이블에서 읽기 전용 조회',
    sideEffect: 'NONE',
    params: [{ name: 'table', label: '테이블', question: '어떤 테이블을 조회할까요?', required: true }],
    io: { inputs: {}, outputs: { rows: 'TableArtifact' } },
  },
];

export const RDB_CATALOG: ConnectorCatalogEntry = {
  id: 'rdb',
  label: 'DB',
  description: 'SQLite/PostgreSQL 읽기',
  connectable: false,
  alwaysReal: false,
  connectionKind: 'config',
  emoji: '🗄️',
};

export const LOCAL_SHEET_CAPABILITIES: ConnectorCapability[] = [
  {
    id: 'local_sheet.read',
    connector: 'local_sheet',
    kind: 'read',
    label: '시트 읽기',
    description: 'CSV/xlsx 읽기',
    sideEffect: 'NONE',
    params: [{ name: 'path', label: '파일 경로', question: '파일 경로를 알려주세요.', required: true }],
    io: { inputs: {}, outputs: { sheet: 'TableArtifact' } },
  },
];

export const LOCAL_SHEET_CATALOG: ConnectorCatalogEntry = {
  id: 'local_sheet',
  label: 'Sheets',
  description: '로컬 CSV/xlsx 읽기',
  connectable: false,
  alwaysReal: false,
  connectionKind: 'builtin',
  emoji: '📊',
};

export const TRANSFORM_CAPABILITIES: ConnectorCapability[] = [
  {
    id: 'transform.table_to_text',
    connector: 'transform',
    kind: 'read',
    label: '표 → 텍스트',
    description: '표 데이터를 텍스트로 변환',
    sideEffect: 'NONE',
    params: [],
    io: { inputs: { table: 'TableArtifact' }, outputs: { text: 'TextArtifact' } },
  },
  {
    id: 'transform.document_to_text',
    connector: 'transform',
    kind: 'read',
    label: '문서 → 텍스트',
    description: '문서 아티팩트에서 텍스트 추출',
    sideEffect: 'NONE',
    params: [],
    io: { inputs: { document: 'DocumentArtifact' }, outputs: { text: 'TextArtifact' } },
  },
];

export const TRANSFORM_CATALOG: ConnectorCatalogEntry = {
  id: 'transform',
  label: 'Transform',
  description: '데이터 계약 변환 (테이블·문서 → 텍스트)',
  connectable: false,
  alwaysReal: true,
  connectionKind: 'builtin',
  emoji: '🔀',
};

export { CONNECTOR_IDS };

export const CAPABILITY_CATALOG: ConnectorCapability[] = [
  ...GMAIL_CAPABILITIES,
  ...SLACK_CAPABILITIES,
  ...LOCAL_FOLDER_CAPABILITIES,
  ...DOCUMENT_CAPABILITIES,
  ...RDB_CAPABILITIES,
  ...LOCAL_SHEET_CAPABILITIES,
  ...TRANSFORM_CAPABILITIES,
];

export const CONNECTOR_CATALOG: Record<ConnectorId, ConnectorCatalogEntry> = {
  gmail: GMAIL_CATALOG,
  slack: SLACK_CATALOG,
  local_folder: LOCAL_FOLDER_CATALOG,
  document: DOCUMENT_CATALOG,
  rdb: RDB_CATALOG,
  local_sheet: LOCAL_SHEET_CATALOG,
  transform: TRANSFORM_CATALOG,
};

export function getCapability(id: string): ConnectorCapability | undefined {
  return CAPABILITY_CATALOG.find((capability) => capability.id === id);
}

export function getCapabilitiesForConnector(connector: string): ConnectorCapability[] {
  return CAPABILITY_CATALOG.filter((capability) => capability.connector === connector);
}
