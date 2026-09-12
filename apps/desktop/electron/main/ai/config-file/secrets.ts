import type { AiBrand, AiConnectionMode } from '@ax-studio/core';
import { getOsSecret, setOsSecret } from '../../credential-store.js';
import { readEnvFile } from '../../env-file.js';
import { readAiToml, writeAiToml } from './storage.js';
import { BRAND_ENV_KEYS, GROK_API_ENV_KEY } from './contracts.js';

export function envKeyForBrand(brand: AiBrand, mode?: AiConnectionMode): string {
  if (brand === 'grok' && mode === 'api') return GROK_API_ENV_KEY;
  return BRAND_ENV_KEYS[brand];
}

export function isAiEnvKey(key: string): boolean {
  return Object.values(BRAND_ENV_KEYS).includes(key) || key === GROK_API_ENV_KEY;
}

export async function setBrandSecret(brand: AiBrand, value: string, mode?: AiConnectionMode): Promise<void> {
  const envKey = envKeyForBrand(brand, mode);
  await setOsSecret(envKey, value);
  process.env[envKey] = value;
}

export async function getSecretForBrand(brand: AiBrand, mode?: AiConnectionMode): Promise<string> {
  const envKey = envKeyForBrand(brand, mode);
  return (await getOsSecret(envKey))?.trim() ?? '';
}

export async function getSecretByEnvKey(envKey: string): Promise<string> {
  return (await getOsSecret(envKey))?.trim() ?? '';
}

/** Startup/inspection must stay usable so the user can replace an unreadable key. */
export async function inspectSecretByEnvKey(envKey: string): Promise<{ value: string; error?: string }> {
  try {
    return { value: await getSecretByEnvKey(envKey) };
  } catch {
    // Never expose the crypto exception, file contents or an inherited fallback key.
    return { value: '', error: '저장된 API 키를 읽을 수 없습니다. 이 PC에서 API 키를 다시 입력해 주세요.' };
  }
}

export async function loadAiSecretsIntoEnv(): Promise<void> {
  const keys = [...Object.values(BRAND_ENV_KEYS), GROK_API_ENV_KEY];
  for (const envKey of keys) {
    const stored = await inspectSecretByEnvKey(envKey);
    if (stored.error) {
      delete process.env[envKey];
      console.warn(`[AX Studio] ${envKey}: ${stored.error}`);
    } else if (stored.value) process.env[envKey] = stored.value;
  }
}

export async function loadAiTomlIntoEnv() {
  await loadAiSecretsIntoEnv();
  return readAiToml();
}

export async function migrateAiSecretsToOsStore(): Promise<void> {
  const config = await readAiToml();
  const envFile = await readEnvFile();
  for (const envKey of [...Object.values(BRAND_ENV_KEYS), GROK_API_ENV_KEY]) {
    const existing = await inspectSecretByEnvKey(envKey);
    // Preserve the original encrypted file; replacing it requires an explicit user action.
    if (existing.error || existing.value) continue;
    const fromToml = (config.secrets[envKey.toLowerCase()] ?? config.secrets[envKey] ?? '').trim();
    const fromEnvFile = (envFile[envKey] ?? '').trim();
    const value = fromToml || fromEnvFile;
    if (value) await setOsSecret(envKey, value);
  }
  if (Object.keys(config.secrets).length > 0) {
    config.secrets = {};
    await writeAiToml(config);
  }
}
