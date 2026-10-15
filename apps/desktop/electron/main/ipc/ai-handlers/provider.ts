import { ipcHandle } from '../ipc-handle.js';
import { getAiProviderDisplay, invalidateBinaryCache, isAiBrand } from '@ax-studio/core';
import { getCore } from '../../core-instance.js';
import { saveActiveAi, saveAiBrandPreferences } from '../../ai/config-file.js';
import { migrateDesktopAiProvider } from '../../ai/provider-migrate.js';

export function registerAiProviderHandlers(): void {
  ipcHandle('ax:setAiProvider', async (_event, raw: unknown) => {
    const core = getCore();
    const config = migrateDesktopAiProvider(raw);
    // A provider switch is a natural point to pick up a newly installed CLI.
    invalidateBinaryCache();
    core.store.setSetting('aiProvider', config);
    core.refreshAgentHarness(config);
    if (config.brand && config.model) await saveActiveAi(config.brand, config.model);
    return { ok: true, label: getAiProviderDisplay(config) };
  });

  ipcHandle(
    'ax:saveAiBrandConfig',
    async (_event, brand: unknown, prefs: { model?: unknown }) => {
      if (!isAiBrand(brand)) throw new Error('지원하지 않는 AI 제공자입니다.');
      if (!prefs || typeof prefs !== 'object' || Array.isArray(prefs)) {
        throw new Error('AI 설정 형식이 올바르지 않습니다.');
      }
      if (prefs.model !== undefined && typeof prefs.model !== 'string') {
        throw new Error('AI 모델 형식이 올바르지 않습니다.');
      }
      await saveAiBrandPreferences(brand, { model: prefs.model?.trim() || undefined });
      return { ok: true };
    },
  );
}
