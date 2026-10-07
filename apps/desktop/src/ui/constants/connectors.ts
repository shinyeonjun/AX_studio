import type { SettingsScreen } from '../../types/navigation';

import gmailIcon from '../images/connectors/gmail.png';
import slackIcon from '../images/connectors/slack.png';
import folderIcon from '../images/connectors/folder.svg';

export type ConnectorUiId =
  | 'gmail'
  | 'slack'
  | 'local_folder'
  | 'http'
  | 'webhook'
  | 'rdb';

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
    description: '메일 읽기·보내기',
    icon: gmailIcon,
    settingsScreen: 'gmail',
    emoji: '📧',
  },
  slack: {
    id: 'slack',
    title: 'Slack',
    description: '채널에 메시지 보내기',
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
    description: '외부 서비스에서 정보 가져오기',
    emojiIcon: '🌐',
    settingsScreen: 'http',
    emoji: '🌐',
  },
  webhook: {
    id: 'webhook',
    title: '외부 신호 받기(Webhook)',
    description: '다른 프로그램이 신호를 보내면 업무 시작',
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
};

export const MESSAGING_CONNECTOR_IDS: ConnectorUiId[] = ['gmail', 'slack'];
export const STORAGE_CONNECTOR_IDS: ConnectorUiId[] = ['local_folder'];
export const API_CONNECTOR_IDS: ConnectorUiId[] = ['http', 'webhook'];
export const DATA_CONNECTOR_IDS: ConnectorUiId[] = ['rdb'];
