import type { SettingsScreen } from '../types/navigation';
import type { AiBrand } from '../types/ai-provider';

export const SETTINGS_TITLES: Record<SettingsScreen, string> = {
  hub: '설정',
  ai: 'AI 연결',
  'ai-claude': 'Claude',
  'ai-gpt': 'GPT',
  'ai-grok': 'Grok',
  'ai-ollama': 'Ollama',
  slack: 'Slack 연결',
  gmail: 'Gmail 연결',
};

export function settingsScreenForBrand(brand: AiBrand): SettingsScreen {
  if (brand === 'claude') return 'ai-claude';
  if (brand === 'gpt') return 'ai-gpt';
  if (brand === 'grok') return 'ai-grok';
  return 'ai-ollama';
}

export function brandFromSettingsScreen(screen: SettingsScreen): AiBrand | null {
  if (screen === 'ai-claude') return 'claude';
  if (screen === 'ai-gpt') return 'gpt';
  if (screen === 'ai-grok') return 'grok';
  if (screen === 'ai-ollama') return 'ollama';
  return null;
}
