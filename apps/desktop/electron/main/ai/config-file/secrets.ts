import type { AiBrand } from '@ax-studio/core';
import { getOsSecret, setOsSecret } from '../../credential-store.js';
import { readEnvFile } from '../../env-file.js';
import { readAiToml, updateAiToml } from './storage.js';
import { BRAND_ENV_KEYS, JEV_API_ENV_KEY } from './contracts.js';

export async function setBrandSecret(brand: AiBrand, value: string): Promise<void> {
  const envKey = BRAND_ENV_KEYS[brand];
  await setOsSecret(envKey, value);
  process.env[envKey] = value;
}

export async function setJevSecret(value: string): Promise<void> {
  await setOsSecret(JEV_API_ENV_KEY, value);
  process.env[JEV_API_ENV_KEY] = value;
}

export async function getJevSecret(): Promise<string> {
  return (await getOsSecret(JEV_API_ENV_KEY)) ?? '';
}

export async function getSecretForBrand(brand: AiBrand): Promise<string> {
  const envKey = BRAND_ENV_KEYS[brand];
  return (await getOsSecret(envKey))?.trim() ?? '';
}

async function loadAiSecretsIntoEnv(): Promise<void> {
  const keys = [...Object.values(BRAND_ENV_KEYS), JEV_API_ENV_KEY];
  for (const envKey of keys) {
    const rawStored = await getOsSecret(envKey);
    const stored = envKey === JEV_API_ENV_KEY ? rawStored : rawStored?.trim();
    if (stored) process.env[envKey] = stored;
  }
}

export async function loadAiTomlIntoEnv() {
  await loadAiSecretsIntoEnv();
  return readAiToml();
}

export async function migrateAiSecretsToOsStore(): Promise<void> {
  const config = await readAiToml();
  const envFile = await readEnvFile();
  for (const envKey of [...Object.values(BRAND_ENV_KEYS), JEV_API_ENV_KEY]) {
    const rawExisting = await getOsSecret(envKey);
    const existing = envKey === JEV_API_ENV_KEY ? rawExisting : rawExisting?.trim();
    if (existing) continue;
    const rawFromToml = config.secrets[envKey.toLowerCase()] ?? config.secrets[envKey] ?? '';
    const rawFromEnvFile = envFile[envKey] ?? '';
    const fromToml = envKey === JEV_API_ENV_KEY ? rawFromToml : rawFromToml.trim();
    const fromEnvFile = envKey === JEV_API_ENV_KEY ? rawFromEnvFile : rawFromEnvFile.trim();
    const value = fromToml || fromEnvFile;
    if (value) await setOsSecret(envKey, value);
  }
  if (Object.keys(config.secrets).length > 0) {
    await updateAiToml((latest) => { latest.secrets = {}; });
  }
}
