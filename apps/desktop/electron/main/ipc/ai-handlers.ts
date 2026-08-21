import { ipcMain } from 'electron';
import {
  detectAiCliProviders,
  getAiProviderDisplay,
  normalizeAiProviderConfig,
} from '@ax-studio/core';
import { getCore } from '../core-instance.js';
import { getEnvFilePath, maskSecret, readEnvFile, setEnvFileValue } from '../env-file.js';
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
} from '../ai/config-file.js';
import { migrateDesktopAiProvider } from '../ai/provider-migrate.js';
import { verifyAiApiKey } from '../ai/api-verify.js';
import { testAiCli } from '../ai/cli-test.js';

const UI_AI_BRANDS: AiBrandId[] = ['claude', 'gpt'];

export function registerAiHandlers() {
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
  ipcMain.handle('ax:setAiProvider', async (_e, raw: unknown) => {
    const core = getCore();
    const config = migrateDesktopAiProvider(raw);
    core.store.setSetting('aiProvider', config);
    core.refreshAgentHarness(config);
    if (config.brand && config.mode && config.model) {
      await saveActiveAi(config.brand as AiBrandId, config.mode, config.model);
    }
    return { ok: true, label: getAiProviderDisplay(config) };
  });
  ipcMain.handle('ax:saveAiBrandConfig', async (_e, brand: AiBrandId, prefs: { mode?: string; model?: string; apiKey?: string }) => {
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
  ipcMain.handle('ax:testAiCli', async (_e, brand: unknown) => {
    if (brand !== 'claude' && brand !== 'gpt' && brand !== 'ollama') {
      throw new Error('Grok/Cursor AI는 더 이상 지원되지 않습니다.');
    }
    return testAiCli(brand);
  });
  ipcMain.handle('ax:testAiApi', async (_e, brand: unknown, apiKey?: unknown, mode?: unknown) => {
    if (brand !== 'claude' && brand !== 'gpt' && brand !== 'ollama') {
      throw new Error('Grok/Cursor AI는 더 이상 지원되지 않습니다.');
    }
    if (apiKey !== undefined && typeof apiKey !== 'string') throw new Error('API 키 형식이 올바르지 않습니다.');
    if (mode !== undefined && mode !== 'cli' && mode !== 'api') throw new Error('AI 연결 방식이 올바르지 않습니다.');
    const testKey = (apiKey?.trim() || (await getSecretForBrand(brand, mode as AiModeId | undefined)) || '').trim();
    if (!testKey) throw new Error('API 키가 없습니다.');
    const result = await verifyAiApiKey(brand as 'claude' | 'gpt', testKey);
    if (apiKey?.trim()) {
      await setBrandSecret(brand, testKey, mode);
    }
    return { ok: true, label: result.label, masked: maskSecret(testKey), saved: Boolean(apiKey?.trim()) };
  });
  ipcMain.handle('ax:setEnvSecret', async (_e, key: unknown, value: unknown) => {
    if (typeof key !== 'string' || !key.trim()) throw new Error('환경 변수 이름이 필요합니다.');
    if (typeof value !== 'string') throw new Error('환경 변수 값 형식이 올바르지 않습니다.');
    const trimmed = value.trim();
    if (!trimmed) throw new Error('값을 입력하세요.');
    if (isAiEnvKey(key)) {
      const brand = (['claude', 'gpt', 'ollama'] as AiBrandId[]).find((item) => envKeyForBrand(item) === key);
      if (brand) await setBrandSecret(brand, trimmed);
    } else {
      await setEnvFileValue(key, trimmed);
      process.env[key] = trimmed;
    }
    return { ok: true, masked: maskSecret(trimmed) };
  });
  ipcMain.handle('ax:getEnvSecretStatus', async (_e, key: unknown) => {
    if (typeof key !== 'string' || !key.trim()) throw new Error('환경 변수 이름이 필요합니다.');
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
}
