import { ipcMain } from 'electron';
import {
  detectAiCliProviders,
  getAiProviderDisplay,
  normalizeAiProviderConfig,
} from '@ax-studio/core';
import { getCore } from '../core-instance.js';
import { getEnvFilePath, maskSecret, readEnvFile, setEnvFileValue } from '../env-file.js';
import { verifyCursorApiKey } from '../cursor-api.js';
import {
  getAiConfigPath,
  getSecretForBrand,
  getSecretByEnvKey,
  isAiEnvKey,
  envKeyForBrand,
  readAiToml,
  saveActiveAi,
  setBrandSecret,
  writeAiToml,
  type AiBrandId,
  type AiModeId,
} from '../ai-config-file.js';
import { verifyAiApiKey } from '../ai-api-verify.js';
import { testAiCli } from '../ai-cli-test.js';

export function registerAiHandlers() {
  ipcMain.handle('ax:detectAiCli', async () => detectAiCliProviders());
  ipcMain.handle('ax:getAiConfig', async () => {
    const config = await readAiToml();
    return {
      path: getAiConfigPath(),
      active: config.active,
      providers: config.providers,
      secrets: Object.fromEntries(
        await Promise.all(
          (['claude', 'gpt', 'grok'] as AiBrandId[]).map(async (brand) => {
            const val = await getSecretForBrand(brand, config.providers[brand]?.mode);
            return [brand, { configured: Boolean(val), masked: val ? maskSecret(val) : undefined }];
          }),
        ),
      ),
    };
  });
  ipcMain.handle('ax:setAiProvider', async (_e, raw: unknown) => {
    const core = getCore();
    const config = normalizeAiProviderConfig(raw);
    core.store.setSetting('aiProvider', config);
    core.refreshAgentHarness(config);
    if (config.brand && config.mode && config.model) {
      await saveActiveAi(config.brand as AiBrandId, config.mode, config.model);
    }
    return { ok: true, label: getAiProviderDisplay(config) };
  });
  ipcMain.handle('ax:saveAiBrandConfig', async (_e, brand: AiBrandId, prefs: { mode?: string; model?: string; apiKey?: string }) => {
    if (prefs.apiKey?.trim()) {
      await setBrandSecret(brand, prefs.apiKey.trim(), prefs.mode as AiModeId | undefined);
    }
    const config = await readAiToml();
    config.providers[brand] = {
      ...config.providers[brand],
      mode: prefs.mode as 'cli' | 'api' | undefined,
      model: prefs.model,
    };
    await writeAiToml(config);
    return { ok: true };
  });
  ipcMain.handle('ax:testAiCli', async (_e, brand: AiBrandId) => testAiCli(brand));
  ipcMain.handle('ax:testAiApi', async (_e, brand: AiBrandId, apiKey?: string, mode?: AiModeId) => {
    const testKey = (apiKey?.trim() || (await getSecretForBrand(brand, mode)) || '').trim();
    if (!testKey) throw new Error('API 키가 없습니다.');
    const result = await verifyAiApiKey(brand as 'claude' | 'gpt' | 'grok', testKey, mode);
    if (apiKey?.trim()) {
      await setBrandSecret(brand, testKey, mode);
    }
    return { ok: true, label: result.label, masked: maskSecret(testKey), saved: Boolean(apiKey?.trim()) };
  });
  ipcMain.handle('ax:setEnvSecret', async (_e, key: string, value: string) => {
    const trimmed = value.trim();
    if (!trimmed) throw new Error('값을 입력하세요.');
    if (isAiEnvKey(key)) {
      if (key === 'XAI_API_KEY') {
        await setBrandSecret('grok', trimmed, 'api');
      } else {
        const brand = (['claude', 'gpt', 'grok', 'ollama'] as AiBrandId[]).find(
          (item) => envKeyForBrand(item) === key,
        );
        if (brand) await setBrandSecret(brand, trimmed);
      }
    } else {
      await setEnvFileValue(key, trimmed);
      process.env[key] = trimmed;
    }
    return { ok: true, masked: maskSecret(trimmed) };
  });
  ipcMain.handle('ax:getEnvSecretStatus', async (_e, key: string) => {
    if (isAiEnvKey(key)) {
      const val = (await getSecretByEnvKey(key)).trim();
      return {
        configured: Boolean(val),
        masked: val ? maskSecret(val) : undefined,
        storage: val ? 'os-credential-store' as const : undefined,
      };
    }
    const env = await readEnvFile();
    const val = (env[key] || process.env[key] || '').trim();
    return {
      configured: Boolean(val),
      masked: val ? maskSecret(val) : undefined,
      envFilePath: getEnvFilePath(),
    };
  });
  ipcMain.handle('ax:setCursorApiKey', async (_e, key: string) => {
    const trimmed = key.trim();
    if (!trimmed) throw new Error('API 키를 입력하세요.');
    await setBrandSecret('grok', trimmed);
    return { ok: true, masked: maskSecret(trimmed) };
  });
  ipcMain.handle('ax:testCursorApiKey', async (_e, key?: string) => {
    const testKey = (key?.trim() || (await getSecretForBrand('grok'))).trim();
    if (!testKey) throw new Error('API 키가 없습니다.');
    const info = await verifyCursorApiKey(testKey);
    return {
      ok: true,
      email: info.email,
      apiKeyName: info.apiKeyName,
      masked: maskSecret(testKey),
    };
  });
}
