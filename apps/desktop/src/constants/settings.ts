import type { SettingsScreen } from '../types/navigation';
import type { AiBrand } from '../types/ai-provider';

export const SETTINGS_TITLES: Record<SettingsScreen, string> = {
  hub: '설정',
  'ai-claude': 'Claude',
  'ai-gpt': 'GPT',
  slack: 'Slack 연결',
  gmail: 'Gmail 연결',
  'local-folder': '로컬 폴더 연결',
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
