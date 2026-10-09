import { ipcHandle } from '../ipc-handle.js';
import { isAiBrand } from '@ax-studio/core';
import { getSecretForBrand, setBrandSecret } from '../../ai/config-file.js';
import { ollamaRunning, verifyAiApiKey } from '../../ai/api-verify.js';
import { testAiCli } from '../../ai/cli-test.js';
import { maskSecret } from '../../env-file.js';

const UNSUPPORTED_BRAND = '지원하지 않는 AI 제공자입니다.';

export function registerAiTestingHandlers(): void {
  // Asked on every settings check: a stopped Ollama answers false instead of logging a failure.
  ipcHandle('ax:probeOllama', async (): Promise<boolean> => ollamaRunning());

  ipcHandle('ax:testAiCli', async (_event, brand: unknown) => {
    if (!isAiBrand(brand)) throw new Error(UNSUPPORTED_BRAND);
    return testAiCli(brand);
  });

  ipcHandle('ax:testAiApi', async (_event, brand: unknown, apiKey?: unknown, mode?: unknown) => {
    if (!isAiBrand(brand)) throw new Error(UNSUPPORTED_BRAND);
    if (apiKey !== undefined && typeof apiKey !== 'string') throw new Error('API 키 형식이 올바르지 않습니다.');
    if (mode !== undefined && mode !== 'cli' && mode !== 'api') throw new Error('AI 연결 방식이 올바르지 않습니다.');
    const isOllama = brand === 'ollama' && mode === 'api';
    const testKey = (apiKey?.trim() || (await getSecretForBrand(brand)) || '').trim();
    if (!isOllama && !testKey) throw new Error('API 키가 없습니다.');
    const result = await verifyAiApiKey(brand, testKey || undefined);
    if (apiKey?.trim() && !isOllama) {
      await setBrandSecret(brand, testKey);
    }
    return { ok: true, label: result.label, masked: maskSecret(testKey), saved: Boolean(apiKey?.trim()) };
  });
}
