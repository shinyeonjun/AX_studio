import { deleteOsSecret, getOsSecret, getOsSecretOrNull, setOsSecret } from '../../credential-store.js';
import { readEnvFile } from '../../env-file.js';
import { readAiToml, updateAiToml } from './storage.js';
import { JEV_API_ENV_KEY, RETIRED_AI_API_ENV_KEYS } from './contracts.js';

export async function setJevSecret(value: string): Promise<void> {
  await setOsSecret(JEV_API_ENV_KEY, value);
  process.env[JEV_API_ENV_KEY] = value;
}

export async function getJevSecret(): Promise<string> {
  return (await getOsSecret(JEV_API_ENV_KEY)) ?? '';
}

export async function loadAiTomlIntoEnv() {
  // A Jev key the OS can no longer decrypt reads as missing; the AI settings still load.
  const stored = await getOsSecretOrNull(JEV_API_ENV_KEY);
  if (stored) process.env[JEV_API_ENV_KEY] = stored;
  return readAiToml();
}

/** Moves a Jev key left in ai.toml [secrets] or the env file into the OS store, and empties [secrets]. */
export async function migrateAiSecretsToOsStore(): Promise<void> {
  const config = await readAiToml();
  if (!await getOsSecret(JEV_API_ENV_KEY)) {
    const envFile = await readEnvFile();
    const value = config.secrets[JEV_API_ENV_KEY.toLowerCase()] ?? config.secrets[JEV_API_ENV_KEY] ?? envFile[JEV_API_ENV_KEY] ?? '';
    if (value) await setOsSecret(JEV_API_ENV_KEY, value);
  }
  if (Object.keys(config.secrets).length > 0) {
    await updateAiToml((latest) => { latest.secrets = {}; });
  }
}

/**
 * AI runs only through the CLIs now, so Claude/OpenAI/Ollama API keys an older build saved are
 * removed from the OS store, once. The Jev key is never touched.
 */
export async function purgeRetiredAiApiKeys(): Promise<void> {
  for (const envKey of RETIRED_AI_API_ENV_KEYS) {
    // Deleted without reading it: a key the OS can no longer decrypt goes too.
    await deleteOsSecret(envKey);
  }
}
