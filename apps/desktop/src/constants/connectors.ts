import type { SettingsScreen } from '../types/navigation';

import gmailIcon from '../images/connectors/gmail.png';
import slackIcon from '../images/connectors/slack.png';

export type ConnectorUiId = 'gmail' | 'slack';

export interface ConnectorUiMeta {
  id: ConnectorUiId;
  title: string;
  description: string;
  icon: string;
  guideKey: string;
  settingsScreen: SettingsScreen;
  emoji: string;
}

export const CONNECTOR_UI_CATALOG: Record<ConnectorUiId, ConnectorUiMeta> = {
  gmail: {
    id: 'gmail',
    title: 'Gmail',
    description: 'OAuth로 메일 읽기·발송',
    icon: gmailIcon,
    guideKey: 'gmail',
    settingsScreen: 'gmail',
    emoji: '📧',
  },
  slack: {
    id: 'slack',
    title: 'Slack',
    description: 'Bot Token으로 메시지 전송',
    icon: slackIcon,
    guideKey: 'slack',
    settingsScreen: 'slack',
    emoji: '💬',
  },
};

export const CONNECTOR_UI_IDS = Object.keys(CONNECTOR_UI_CATALOG) as ConnectorUiId[];

export function connectorLabel(id: string): string {
  return CONNECTOR_UI_CATALOG[id as ConnectorUiId]?.title ?? id;
}

export function connectorEmoji(id: string): string {
  return CONNECTOR_UI_CATALOG[id as ConnectorUiId]?.emoji ?? '⚙️';
}
