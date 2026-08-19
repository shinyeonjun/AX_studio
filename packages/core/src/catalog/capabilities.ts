import { z } from 'zod';
import { CapabilityIOSchema } from '../contracts/capability-io.js';

export const CapabilityRiskSchema = z.enum(['read', 'write', 'trigger']);

export const CapabilityParamSchema = z.object({
  name: z.string(),
  label: z.string(),
  question: z.string(),
  required: z.boolean().default(false),
});

export const ConnectorCapabilitySchema = z.object({
  id: z.string(),
  connector: z.string(),
  kind: z.enum(['read', 'write', 'trigger']),
  /** Short one-line label for workflow graph / cards. */
  label: z.string(),
  description: z.string(),
  sideEffect: z.enum(['NONE', 'REVERSIBLE', 'EXTERNAL', 'EXTERNAL_HIGH']).optional(),
  params: z.array(CapabilityParamSchema).default([]),
  io: CapabilityIOSchema.optional(),
});

export type CapabilityParam = z.infer<typeof CapabilityParamSchema>;
export type ConnectorCapability = z.infer<typeof ConnectorCapabilitySchema>;

export const CAPABILITY_CATALOG: ConnectorCapability[] = [
  {
    id: 'gmail.messages.read',
    connector: 'gmail',
    kind: 'read',
    label: '메일 읽기',
    description: '메일 본문·헤더 읽기',
    sideEffect: 'NONE',
    params: [{ name: 'messageId', label: '메일 ID', question: '어떤 메일을 읽을까요?', required: false }],
    io: {
      inputs: { message: 'EmailMessageRef' },
      outputs: { body: 'TextArtifact' },
    },
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
    io: {
      inputs: { body: 'TextArtifact' },
      outputs: { draft: 'EmailMessageRef' },
    },
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
    io: {
      inputs: { body: 'TextArtifact' },
      outputs: { message: 'EmailMessageRef' },
    },
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
    io: {
      inputs: { text: 'TextArtifact' },
      outputs: { message: 'SlackMessageRef' },
    },
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
  {
    id: 'rdb.schema.describe',
    connector: 'rdb',
    kind: 'read',
    label: 'DB 스키마',
    description: 'DB 스키마 조회',
    sideEffect: 'NONE',
    params: [{ name: 'connectionId', label: 'DB 연결', question: '어떤 DB에 연결할까요?', required: true }],
  },
  {
    id: 'rdb.query.read',
    connector: 'rdb',
    kind: 'read',
    label: 'DB 조회',
    description: '읽기 전용 SQL 조회',
    sideEffect: 'NONE',
    params: [
      { name: 'connectionId', label: 'DB 연결', question: '어떤 DB에 연결할까요?', required: true },
      { name: 'sql', label: '쿼리', question: '어떤 조회를 할까요?', required: false },
    ],
    io: {
      inputs: {},
      outputs: { rows: 'TableArtifact' },
    },
  },
  {
    id: 'local_sheet.read',
    connector: 'local_sheet',
    kind: 'read',
    label: '시트 읽기',
    description: 'CSV/xlsx 읽기',
    sideEffect: 'NONE',
    params: [{ name: 'path', label: '파일 경로', question: '파일 경로를 알려주세요.', required: true }],
    io: {
      inputs: {},
      outputs: { sheet: 'TableArtifact' },
    },
  },
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
    params: [{ name: 'path', label: '파일 경로', question: '어떤 파일을 읽을까요?', required: true }],
  },
  {
    id: 'document.ingest',
    connector: 'document',
    kind: 'read',
    label: '문서 읽기',
    description: 'Document Engine으로 문서 파싱',
    sideEffect: 'NONE',
    params: [{ name: 'path', label: '문서 경로', question: '어떤 문서를 읽을까요?', required: true }],
    io: {
      inputs: { source: 'DocumentIngestInput' },
      outputs: { document: 'DocumentArtifact' },
    },
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
  {
    id: 'transform.table_to_text',
    connector: 'transform',
    kind: 'read',
    label: '표 → 텍스트',
    description: '표 데이터를 텍스트로 변환',
    sideEffect: 'NONE',
    params: [],
    io: {
      inputs: { table: 'TableArtifact' },
      outputs: { text: 'TextArtifact' },
    },
  },
  {
    id: 'transform.document_to_text',
    connector: 'transform',
    kind: 'read',
    label: '문서 → 텍스트',
    description: '문서 아티팩트에서 텍스트 추출',
    sideEffect: 'NONE',
    params: [],
    io: {
      inputs: { document: 'DocumentArtifact' },
      outputs: { text: 'TextArtifact' },
    },
  },
];

export function getCapability(id: string): ConnectorCapability | undefined {
  return CAPABILITY_CATALOG.find((c) => c.id === id);
}

export function getCapabilitiesForConnector(connector: string): ConnectorCapability[] {
  return CAPABILITY_CATALOG.filter((c) => c.connector === connector);
}

export interface ConnectorConnection {
  connector: string;
  connected: boolean;
  config?: Record<string, unknown>;
}

export function checkRequiredConnections(
  requiredCapabilityIds: string[],
  connections: ConnectorConnection[],
): { missing: string[] } {
  const connectedConnectors = new Set(
    connections.filter((c) => c.connected).map((c) => c.connector),
  );
  const missing: string[] = [];
  for (const capId of requiredCapabilityIds) {
    const cap = getCapability(capId);
    if (!cap) continue;
    if (!connectedConnectors.has(cap.connector)) {
      if (!missing.includes(cap.connector)) {
        missing.push(cap.connector);
      }
    }
  }
  return { missing };
}
