import { getCapabilitiesForConnector } from './capabilities.js';

export const CONNECTOR_IDS = ['gmail', 'slack', 'report', 'rdb', 'local_sheet'] as const;
export type ConnectorId = (typeof CONNECTOR_IDS)[number];

export type ConnectorConnectionKind = 'oauth-loopback' | 'token' | 'config' | 'builtin';

export interface ConnectorCatalogEntry {
  id: ConnectorId;
  label: string;
  description: string;
  /** 설정 화면에 노출할 연결 UI가 있는지 */
  connectable: boolean;
  /** 런타임에 항상 실제 구현을 쓰는지 (report 등) */
  alwaysReal: boolean;
  connectionKind: ConnectorConnectionKind;
  emoji: string;
}

export const CONNECTOR_CATALOG: Record<ConnectorId, ConnectorCatalogEntry> = {
  gmail: {
    id: 'gmail',
    label: 'Gmail',
    description: 'OAuth로 메일 읽기·발송',
    connectable: true,
    alwaysReal: false,
    connectionKind: 'oauth-loopback',
    emoji: '📧',
  },
  slack: {
    id: 'slack',
    label: 'Slack',
    description: 'Bot Token으로 메시지 전송',
    connectable: true,
    alwaysReal: false,
    connectionKind: 'token',
    emoji: '💬',
  },
  report: {
    id: 'report',
    label: 'Report',
    description: 'HTML/DOCX/PDF 보고서 생성',
    connectable: false,
    alwaysReal: true,
    connectionKind: 'builtin',
    emoji: '📄',
  },
  rdb: {
    id: 'rdb',
    label: 'DB',
    description: 'SQLite/PostgreSQL 읽기',
    connectable: false,
    alwaysReal: false,
    connectionKind: 'config',
    emoji: '🗄️',
  },
  local_sheet: {
    id: 'local_sheet',
    label: 'Sheets',
    description: '로컬 CSV/xlsx 읽기',
    connectable: false,
    alwaysReal: false,
    connectionKind: 'builtin',
    emoji: '📊',
  },
};

export const CONNECTABLE_CONNECTOR_IDS = CONNECTOR_IDS.filter(
  (id) => CONNECTOR_CATALOG[id].connectable,
) as ConnectorId[];

export function getConnectorCatalogEntry(id: string): ConnectorCatalogEntry | undefined {
  return CONNECTOR_CATALOG[id as ConnectorId];
}

export function getConnectorLabel(id: string): string {
  return CONNECTOR_CATALOG[id as ConnectorId]?.label ?? id;
}

export function getConnectorEmoji(id: string): string {
  return CONNECTOR_CATALOG[id as ConnectorId]?.emoji ?? '⚙️';
}

export function listConnectorCapabilities(id: ConnectorId): string[] {
  return getCapabilitiesForConnector(id).map((cap) => cap.id);
}
