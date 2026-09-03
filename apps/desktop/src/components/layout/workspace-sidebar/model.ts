import type { AppState } from '../../../types/app-state';
import type { SettingsScreen } from '../../../types/navigation';
import { CONNECTOR_UI_CATALOG } from '../../../constants/connectors';
import type { AiBrand } from '../../../types/ai-provider';

export interface SidebarSettingsLink {
  screen: SettingsScreen;
  label: string;
  icon?: string;
  emojiIcon?: string;
  useSettingsIcon?: boolean;
}

export const SIDEBAR_AI_BRANDS: AiBrand[] = ['claude', 'gpt'];

export const SIDEBAR_CONNECTOR_LINKS: SidebarSettingsLink[] = [
  { screen: 'slack', label: 'Slack', icon: CONNECTOR_UI_CATALOG.slack.icon },
  { screen: 'gmail', label: 'Gmail', icon: CONNECTOR_UI_CATALOG.gmail.icon },
  {
    screen: 'local-folder',
    label: '로컬 폴더',
    icon: CONNECTOR_UI_CATALOG.local_folder.icon,
    emojiIcon: CONNECTOR_UI_CATALOG.local_folder.emoji,
  },
  {
    screen: 'http',
    label: 'HTTP API',
    emojiIcon: CONNECTOR_UI_CATALOG.http.emojiIcon,
  },
  {
    screen: 'webhook',
    label: 'Webhook',
    emojiIcon: CONNECTOR_UI_CATALOG.webhook.emojiIcon,
  },
  {
    screen: 'rdb',
    label: '데이터베이스',
    emojiIcon: CONNECTOR_UI_CATALOG.rdb.emojiIcon,
  },
];

export function isConnectorConnected(state: AppState | null, screen: SettingsScreen): boolean {
  if (!state) return false;
  if (screen === 'slack') {
    return state.connections?.find((connection) => connection.connector === 'slack')?.connected ?? false;
  }
  if (screen === 'gmail') {
    return state.connections?.find((connection) => connection.connector === 'gmail')?.connected ?? false;
  }
  if (screen === 'local-folder') {
    return (state.localFolders?.length ?? 0) > 0;
  }
  if (screen === 'http') {
    return state.connections?.find((connection) => connection.connector === 'http')?.connected ?? false;
  }
  if (screen === 'webhook') {
    return state.connections?.find((connection) => connection.connector === 'webhook')?.connected ?? false;
  }
  if (screen === 'rdb') {
    return state.connections?.find((connection) => connection.connector === 'rdb')?.connected ?? false;
  }
  return false;
}

export function connectorCount(
  state: AppState | null,
  screen: SettingsScreen,
): number | undefined {
  if (screen === 'local-folder') return state?.localFolders?.length ?? 0;
  if (screen === 'http') {
    return state?.connections?.find((connection) => connection.connector === 'http')?.endpoints?.length;
  }
  return undefined;
}
