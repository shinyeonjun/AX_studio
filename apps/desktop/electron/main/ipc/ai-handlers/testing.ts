import { ipcMain } from 'electron';
import { type AiConnectionMode } from '@ax-studio/core';
import { getSecretForBrand, setBrandSecret } from '../../ai/config-file.js';
import { verifyAiApiKey } from '../../ai/api-verify.js';
import { testAiCli } from '../../ai/cli-test.js';
import { maskSecret } from '../../env-file.js';

export function registerAiTestingHandlers(): void {
  ipcMain.handle('ax:testAiCli', async (_event, brand: unknown) => {
    if (brand !== 'claude' && brand !== 'gpt' && brand !== 'ollama') {
      throw new Error('Grok/Cursor AI는 더 이상 지원되지 않습니다.');
    }
    return testAiCli(brand);
  });

  ipcMain.handle('ax:testAiApi', async (_event, brand: unknown, apiKey?: unknown, mode?: unknown) => {
    if (brand !== 'claude' && brand !== 'gpt' && brand !== 'ollama') {
      throw new Error('Grok/Cursor AI는 더 이상 지원되지 않습니다.');
    }
    if (apiKey !== undefined && typeof apiKey !== 'string') throw new Error('API 키 형식이 올바르지 않습니다.');
    if (mode !== undefined && mode !== 'cli' && mode !== 'api') throw new Error('AI 연결 방식이 올바르지 않습니다.');
    const isOllama = brand === 'ollama' && mode === 'api';
    const testKey = (apiKey?.trim() || (await getSecretForBrand(brand, mode as AiConnectionMode | undefined)) || '').trim();
    if (!isOllama && !testKey) throw new Error('API 키가 없습니다.');
    const result = await verifyAiApiKey(brand, testKey || undefined);
    if (apiKey?.trim() && !isOllama) {
      await setBrandSecret(brand, testKey, mode);
    }
    return { ok: true, label: result.label, masked: maskSecret(testKey), saved: Boolean(apiKey?.trim()) };
  });
}
