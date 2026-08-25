import type { SettingsScreen } from '../types/navigation';

import gmailIcon from '../images/connectors/gmail.png';
import slackIcon from '../images/connectors/slack.png';
import folderIcon from '../images/connectors/folder.svg';

export type ConnectorUiId =
  | 'gmail'
  | 'slack'
  | 'local_folder'
  | 'http'
  | 'webhook'
  | 'rdb'
  | 'openapi'
  | 'mcp';

export interface ConnectorUiMeta {
  id: ConnectorUiId;
  title: string;
  description: string;
  icon?: string;
  emojiIcon?: string;
  settingsScreen: SettingsScreen;
  emoji: string;
}

export const CONNECTOR_UI_CATALOG: Record<ConnectorUiId, ConnectorUiMeta> = {
  gmail: {
    id: 'gmail',
    title: 'Gmail',
    description: 'OAuth로 메일 읽기·발송',
    icon: gmailIcon,
    settingsScreen: 'gmail',
    emoji: '📧',
  },
  slack: {
    id: 'slack',
    title: 'Slack',
    description: 'Bot Token으로 메시지 전송',
    icon: slackIcon,
    settingsScreen: 'slack',
    emoji: '💬',
  },
  local_folder: {
    id: 'local_folder',
    title: '로컬 폴더',
    description: '내 PC 폴더를 문서·파일 소스로 연결',
    icon: folderIcon,
    settingsScreen: 'local-folder',
    emoji: '📁',
  },
  http: {
    id: 'http',
    title: 'HTTP API',
    description: 'REST API 아웃바운드 요청',
    emojiIcon: '🌐',
    settingsScreen: 'http',
    emoji: '🌐',
  },
  webhook: {
    id: 'webhook',
    title: 'Webhook',
    description: '로컬 HTTP 수신 트리거',
    emojiIcon: '🔔',
    settingsScreen: 'webhook',
    emoji: '🔔',
  },
  rdb: {
    id: 'rdb',
    title: '데이터베이스',
    description: 'SQLite/PostgreSQL 읽기 전용 조회',
    emojiIcon: '🗄️',
    settingsScreen: 'rdb',
    emoji: '🗄️',
  },
  openapi: {
    id: 'openapi',
    title: 'OpenAPI',
    description: 'OpenAPI spec에서 동적 API 연결',
    emojiIcon: '📜',
    settingsScreen: 'openapi',
    emoji: '📜',
  },
  mcp: {
    id: 'mcp',
    title: 'MCP',
    description: 'MCP tool 정의를 워크플로우에 등록',
    emojiIcon: '🔌',
    settingsScreen: 'mcp',
    emoji: '🔌',
  },
};

export const CONNECTOR_UI_IDS = Object.keys(CONNECTOR_UI_CATALOG) as ConnectorUiId[];

export const MESSAGING_CONNECTOR_IDS: ConnectorUiId[] = ['gmail', 'slack'];
export const STORAGE_CONNECTOR_IDS: ConnectorUiId[] = ['local_folder'];
export const API_CONNECTOR_IDS: ConnectorUiId[] = ['http', 'webhook'];
/** Connectors kept in catalog but hidden until product-ready. */
export const HIDDEN_CONNECTOR_UI_IDS: ConnectorUiId[] = ['openapi', 'mcp'];

export const DATA_CONNECTOR_IDS: ConnectorUiId[] = ['rdb'];

export function isConnectorVisibleInUi(id: ConnectorUiId): boolean {
  return !HIDDEN_CONNECTOR_UI_IDS.includes(id);
}

export function connectorLabel(id: string): string {
  return CONNECTOR_UI_CATALOG[id as ConnectorUiId]?.title ?? id;
}

export function connectorEmoji(id: string): string {
  return CONNECTOR_UI_CATALOG[id as ConnectorUiId]?.emoji ?? '⚙️';
}
