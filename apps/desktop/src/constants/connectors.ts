import type { SettingsScreen } from '../types/navigation';

import gmailIcon from '../images/connectors/gmail.png';
import slackIcon from '../images/connectors/slack.png';
import folderIcon from '../images/connectors/folder.svg';

export type ConnectorUiId = 'gmail' | 'slack' | 'local_folder';

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
};

export const CONNECTOR_UI_IDS = Object.keys(CONNECTOR_UI_CATALOG) as ConnectorUiId[];

export const MESSAGING_CONNECTOR_IDS: ConnectorUiId[] = ['gmail', 'slack'];
export const STORAGE_CONNECTOR_IDS: ConnectorUiId[] = ['local_folder'];

export function connectorLabel(id: string): string {
  return CONNECTOR_UI_CATALOG[id as ConnectorUiId]?.title ?? id;
}

export function connectorEmoji(id: string): string {
  return CONNECTOR_UI_CATALOG[id as ConnectorUiId]?.emoji ?? '⚙️';
}
