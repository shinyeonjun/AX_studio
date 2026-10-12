import type { AppState } from '../../../types/app-state';
import type { SettingsScreen } from '../../../types/navigation';
import { CONNECTOR_UI_CATALOG } from '../../constants/connectors';
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

const SCREEN_CONNECTOR: Partial<Record<SettingsScreen, string>> = {
  slack: 'slack', gmail: 'gmail', http: 'http', webhook: 'webhook', rdb: 'rdb',
};

/**
 * Why a connected connector cannot be used right now, or undefined. Real use: Gmail showed
 * "연결됨" with an expired sign-in, and a folder that no longer existed showed green.
 */
export function connectorAttention(state: AppState | null, screen: SettingsScreen): string | undefined {
  if (!state) return undefined;
  if (screen === 'local-folder') {
    const missing = state.localFolders?.filter((folder) => folder.missing).length ?? 0;
    return missing > 0 ? `연결한 폴더 ${missing}개를 찾을 수 없어요.` : undefined;
  }
  const connector = SCREEN_CONNECTOR[screen];
  const entry = connector ? state.connections?.find((connection) => connection.connector === connector) : undefined;
  if (!entry?.connected) return undefined;
  if (entry.lastError) return entry.lastError;
  if (entry.endpoints?.some((endpoint) => endpoint.needsReconnect)) return '다시 연결해야 하는 API가 있어요.';
  if (entry.databases?.some((database) => database.needsReconnect)) return '다시 연결해야 하는 데이터베이스가 있어요.';
  return undefined;
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
