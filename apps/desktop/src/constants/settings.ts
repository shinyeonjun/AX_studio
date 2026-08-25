import type { SettingsScreen } from '../types/navigation';
import type { AiBrand } from '../types/ai-provider';

/** Settings detail screens hidden until the connector is product-ready. */
export const HIDDEN_SETTINGS_SCREENS: SettingsScreen[] = ['openapi', 'mcp'];

export function isSettingsScreenVisibleInUi(screen: SettingsScreen): boolean {
  return !HIDDEN_SETTINGS_SCREENS.includes(screen);
}

export const SETTINGS_TITLES: Record<SettingsScreen, string> = {
  hub: '설정',
  'ai-claude': 'Claude',
  'ai-gpt': 'GPT',
  slack: 'Slack 연결',
  gmail: 'Gmail 연결',
  'local-folder': '로컬 폴더 연결',
  http: 'HTTP API 연결',
  webhook: 'Webhook 수신',
  rdb: '데이터베이스 연결',
  openapi: 'OpenAPI 연결',
  mcp: 'MCP 연결',
};

export function settingsScreenForBrand(brand: AiBrand): SettingsScreen {
  if (brand === 'claude') return 'ai-claude';
  if (brand === 'gpt') return 'ai-gpt';
  return 'ai-claude';
}

export function brandFromSettingsScreen(screen: SettingsScreen): AiBrand | null {
  if (screen === 'ai-claude') return 'claude';
  if (screen === 'ai-gpt') return 'gpt';
  return null;
}
