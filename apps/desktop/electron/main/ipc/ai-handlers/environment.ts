import { ipcMain } from 'electron';
import { type AiBrand } from '@ax-studio/core';
import { ENV_FILE_ALLOWED_KEYS, getEnvFilePath, maskSecret, readEnvFile, setEnvFileValue } from '../../env-file.js';
import {
  getSecretByEnvKey,
  isAiEnvKey,
  envKeyForBrand,
  setBrandSecret,
} from '../../ai/config-file.js';

export function registerAiEnvironmentHandlers(): void {
  ipcMain.handle('ax:setEnvSecret', async (_event, key: unknown, value: unknown) => {
    if (typeof key !== 'string' || !key.trim()) throw new Error('환경 변수 이름이 필요합니다.');
    if (typeof value !== 'string') throw new Error('환경 변수 값 형식이 올바르지 않습니다.');
    const trimmed = value.trim();
    if (!trimmed) throw new Error('값을 입력하세요.');
    if (isAiEnvKey(key)) {
      const brand = (['claude', 'gpt', 'ollama'] as AiBrand[]).find((item) => envKeyForBrand(item) === key);
      if (brand) await setBrandSecret(brand, trimmed);
    } else {
      await setEnvFileValue(key, trimmed);
      process.env[key] = trimmed;
    }
    return { ok: true, masked: maskSecret(trimmed) };
  });

  ipcMain.handle('ax:getEnvSecretStatus', async (_event, key: unknown) => {
    if (typeof key !== 'string' || !key.trim()) throw new Error('환경 변수 이름이 필요합니다.');
    if (!isAiEnvKey(key) && !ENV_FILE_ALLOWED_KEYS.has(key)) {
      throw new Error('조회할 수 없는 환경 변수입니다.');
    }
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
