import { ipcMain } from 'electron';
import {
  getAiProviderDisplay,
  type AiBrand,
  type AiConnectionMode,
} from '@ax-studio/core';
import { getCore } from '../../core-instance.js';
import {
  readAiToml,
  saveActiveAi,
  setBrandSecret,
  writeAiToml,
} from '../../ai/config-file.js';
import { migrateDesktopAiProvider } from '../../ai/provider-migrate.js';

export function registerAiProviderHandlers(): void {
  ipcMain.handle('ax:setAiProvider', async (_event, raw: unknown) => {
    const core = getCore();
    const config = migrateDesktopAiProvider(raw);
    core.store.setSetting('aiProvider', config);
    core.refreshAgentHarness(config);
    if (config.brand && config.mode && config.model) {
      await saveActiveAi(config.brand as AiBrand, config.mode, config.model);
    }
    return { ok: true, label: getAiProviderDisplay(config) };
  });

  ipcMain.handle(
    'ax:saveAiBrandConfig',
    async (_event, brand: AiBrand, prefs: { mode?: string; model?: string; apiKey?: string }) => {
      if (brand !== 'claude' && brand !== 'gpt' && brand !== 'ollama') {
        throw new Error('Grok/Cursor AI는 더 이상 지원되지 않습니다.');
      }
      if (!prefs || typeof prefs !== 'object' || Array.isArray(prefs)) {
        throw new Error('AI 설정 형식이 올바르지 않습니다.');
      }
      if (prefs.apiKey !== undefined && typeof prefs.apiKey !== 'string') {
        throw new Error('API 키 형식이 올바르지 않습니다.');
      }
      if (prefs.model !== undefined && typeof prefs.model !== 'string') {
        throw new Error('AI 모델 형식이 올바르지 않습니다.');
      }
      if (prefs.mode !== undefined && prefs.mode !== 'cli' && prefs.mode !== 'api') {
        throw new Error('AI 연결 방식은 cli 또는 api여야 합니다.');
      }
      if (prefs.apiKey?.trim()) {
        await setBrandSecret(brand, prefs.apiKey.trim(), prefs.mode as AiConnectionMode | undefined);
      }
      const config = await readAiToml();
      config.providers[brand] = {
        ...config.providers[brand],
        mode: prefs.mode as 'cli' | 'api' | undefined,
        model: prefs.model,
      };
      await writeAiToml(config);
      return { ok: true };
    },
  );
}
