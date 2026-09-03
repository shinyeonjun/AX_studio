import { ipcMain } from 'electron';
import { detectAiCliProviders, type AiBrand } from '@ax-studio/core';
import {
  getAiConfigPath,
  getSecretForBrand,
  readAiToml,
} from '../../ai/config-file.js';
import { maskSecret } from '../../env-file.js';

const UI_AI_BRANDS: AiBrand[] = ['claude', 'gpt', 'ollama'];

export function registerAiInspectionHandlers(): void {
  ipcMain.handle('ax:detectAiCli', async () => {
    const detected = await detectAiCliProviders();
    return detected.filter((item) => item.id !== 'cursor-cli');
  });

  ipcMain.handle('ax:getAiConfig', async () => {
    const config = await readAiToml();
    return {
      path: getAiConfigPath(),
      active: config.active,
      providers: config.providers,
      secrets: Object.fromEntries(
        await Promise.all(
          UI_AI_BRANDS.map(async (brand) => {
            const val = await getSecretForBrand(brand, config.providers[brand]?.mode);
            return [brand, { configured: Boolean(val), masked: val ? maskSecret(val) : undefined }];
          }),
        ),
      ),
    };
  });
}
