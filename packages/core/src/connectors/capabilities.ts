import { z } from 'zod';

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
  description: z.string(),
  sideEffect: z.enum(['NONE', 'REVERSIBLE', 'EXTERNAL', 'EXTERNAL_HIGH']).optional(),
  params: z.array(CapabilityParamSchema).default([]),
  inputSchema: z.record(z.unknown()).optional(),
  outputSchema: z.record(z.unknown()).optional(),
});

export type CapabilityParam = z.infer<typeof CapabilityParamSchema>;
export type ConnectorCapability = z.infer<typeof ConnectorCapabilitySchema>;

export const CAPABILITY_CATALOG: ConnectorCapability[] = [
  {
    id: 'gmail.messages.read',
    connector: 'gmail',
    kind: 'read',
    description: 'Read email messages',
    sideEffect: 'NONE',
    params: [{ name: 'messageId', label: '메일 ID', question: '어떤 메일을 읽을까요?', required: false }],
  },
  {
    id: 'gmail.messages.search',
    connector: 'gmail',
    kind: 'read',
    description: 'Search emails',
    sideEffect: 'NONE',
    params: [{ name: 'query', label: '검색어', question: '어떤 조건으로 메일을 찾을까요?', required: false }],
  },
  {
    id: 'gmail.draft.create',
    connector: 'gmail',
    kind: 'write',
    description: 'Create draft',
    sideEffect: 'REVERSIBLE',
    params: [
      { name: 'to', label: '수신자', question: '초안을 누구에게 보낼까요?', required: true },
      { name: 'subject', label: '제목', question: '메일 제목은요?', required: false },
      { name: 'body', label: '본문', question: '메일 내용은요?', required: false },
    ],
  },
  {
    id: 'gmail.message.send',
    connector: 'gmail',
    kind: 'write',
    description: 'Send email',
    sideEffect: 'EXTERNAL_HIGH',
    params: [
      { name: 'to', label: '수신자', question: '메일을 누구에게 보낼까요?', required: true },
      { name: 'subject', label: '제목', question: '메일 제목은요?', required: false },
      { name: 'body', label: '본문', question: '메일 내용은요?', required: false },
    ],
  },
  {
    id: 'gmail.new_message',
    connector: 'gmail',
    kind: 'trigger',
    description: 'Gmail 새 메일 도착 시 업무 시작',
    params: [{ name: 'accountId', label: 'Gmail 계정', question: '어떤 Gmail 계정을 사용할까요?', required: true }],
  },
  {
    id: 'slack.message.send',
    connector: 'slack',
    kind: 'write',
    description: 'Send Slack message',
    sideEffect: 'EXTERNAL',
    params: [
      { name: 'channel', label: 'Slack 채널', question: 'Slack 채널은 어디인가요?', required: true },
      { name: 'text', label: '메시지', question: '무슨 내용을 보낼까요?', required: false },
    ],
  },
  {
    id: 'slack.new_message',
    connector: 'slack',
    kind: 'trigger',
    description: 'Slack 채널 새 메시지 도착 시 업무 시작',
    params: [{ name: 'channel', label: 'Slack 채널', question: '어떤 Slack 채널을 감시할까요?', required: true }],
  },
  {
    id: 'rdb.schema.describe',
    connector: 'rdb',
    kind: 'read',
    description: 'Describe DB schema',
    sideEffect: 'NONE',
    params: [{ name: 'connectionId', label: 'DB 연결', question: '어떤 DB에 연결할까요?', required: true }],
  },
  {
    id: 'rdb.query.read',
    connector: 'rdb',
    kind: 'read',
    description: 'Read-only SQL query',
    sideEffect: 'NONE',
    params: [
      { name: 'connectionId', label: 'DB 연결', question: '어떤 DB에 연결할까요?', required: true },
      { name: 'sql', label: '쿼리', question: '어떤 조회를 할까요?', required: false },
    ],
  },
  {
    id: 'local_sheet.read',
    connector: 'local_sheet',
    kind: 'read',
    description: 'Read CSV/xlsx',
    sideEffect: 'NONE',
    params: [{ name: 'path', label: '파일 경로', question: '파일 경로를 알려주세요.', required: true }],
  },
  {
    id: 'report.html.render',
    connector: 'report',
    kind: 'write',
    description: 'Render HTML report',
    sideEffect: 'REVERSIBLE',
    params: [{ name: 'template', label: '리포트 양식', question: '어떤 보고서 양식을 사용할까요?', required: true }],
  },
  {
    id: 'report.docx.fill',
    connector: 'report',
    kind: 'write',
    description: 'Fill DOCX template',
    sideEffect: 'REVERSIBLE',
    params: [{ name: 'template', label: '리포트 양식', question: '어떤 보고서 양식을 사용할까요?', required: true }],
  },
  {
    id: 'report.pdf.generate',
    connector: 'report',
    kind: 'write',
    description: 'Generate PDF',
    sideEffect: 'REVERSIBLE',
    params: [{ name: 'template', label: '리포트 양식', question: '어떤 보고서 양식을 사용할까요?', required: true }],
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
