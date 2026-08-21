import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { app } from 'electron';
import { getOsSecret, setOsSecret } from '../credential-store.js';
import { getDesktopAxDataPaths } from '../data-paths.js';
import { readEnvFile } from '../env-file.js';

export type AiBrandId = 'claude' | 'gpt' | 'grok' | 'ollama';
export type AiModeId = 'cli' | 'api';

export interface AiBrandTomlConfig {
  mode?: AiModeId;
  model?: string;
}

export interface AiTomlConfig {
  active?: {
    brand: AiBrandId;
    mode: AiModeId;
    model: string;
  };
  providers: Partial<Record<AiBrandId, AiBrandTomlConfig>>;
  /** 레거시 [secrets] 파싱용. 저장하지 않음. */
  secrets: Record<string, string>;
}

const BRAND_ENV_KEYS: Record<AiBrandId, string> = {
  claude: 'ANTHROPIC_API_KEY',
  gpt: 'OPENAI_API_KEY',
  grok: 'CURSOR_API_KEY',
  ollama: 'OLLAMA_API_KEY',
};

const GROK_API_ENV_KEY = 'XAI_API_KEY';

export function getAiConfigPath(): string {
  if (app.isPackaged) {
    return join(getDesktopAxDataPaths().config, 'ai.toml');
  }
  return join(app.getAppPath(), '../../ai.toml');
}

function emptyConfig(): AiTomlConfig {
  return { providers: {}, secrets: {} };
}

function parseTomlValue(raw: string): string {
  const trimmed = raw.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function unescapeTomlString(value: string): string {
  return value.replace(/\\n/g, '\n').replace(/\\"/g, '"');
}

export function parseAiToml(content: string): AiTomlConfig {
  const config = emptyConfig();
  let section = '';

  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const sectionMatch = trimmed.match(/^\[([^\]]+)\]$/);
    if (sectionMatch) {
      section = sectionMatch[1];
      continue;
    }

    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = unescapeTomlString(parseTomlValue(trimmed.slice(eq + 1)));

    if (section === 'active') {
      config.active ??= { brand: 'claude', mode: 'cli', model: 'sonnet' };
      if (key === 'brand') config.active.brand = value as AiBrandId;
      if (key === 'mode') config.active.mode = value as AiModeId;
      if (key === 'model') config.active.model = value;
      continue;
    }

    if (section === 'secrets') {
      config.secrets[key] = value;
      continue;
    }

    const providerMatch = section.match(/^providers\.(.+)$/);
    if (providerMatch) {
      const brand = providerMatch[1] as AiBrandId;
      config.providers[brand] ??= {};
      if (key === 'mode') config.providers[brand]!.mode = value as AiModeId;
      if (key === 'model') config.providers[brand]!.model = value;
    }
  }

  return config;
}

function escapeTomlString(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`;
}

export function serializeAiToml(config: AiTomlConfig): string {
  const lines = [
    '# AX Studio AI settings',
    '# 개발: 프로젝트 루트 ai.toml / 릴리즈: %LOCALAPPDATA%\\AXStudio\\config\\ai.toml',
    '# API 키는 이 파일에 저장하지 않습니다.',
    '',
  ];

  if (config.active) {
    lines.push('[active]', `brand = ${escapeTomlString(config.active.brand)}`, `mode = ${escapeTomlString(config.active.mode)}`, `model = ${escapeTomlString(config.active.model)}`, '');
  }

  for (const [brand, provider] of Object.entries(config.providers)) {
    if (!provider) continue;
    lines.push(`[providers.${brand}]`);
    if (provider.mode) lines.push(`mode = ${escapeTomlString(provider.mode)}`);
    if (provider.model) lines.push(`model = ${escapeTomlString(provider.model)}`);
    lines.push('');
  }

  return lines.join('\n');
}

export async function readAiToml(): Promise<AiTomlConfig> {
  const path = getAiConfigPath();
  if (!existsSync(path)) return emptyConfig();
  const content = await readFile(path, 'utf8');
  return parseAiToml(content);
}

export async function writeAiToml(config: AiTomlConfig): Promise<void> {
  await writeFile(getAiConfigPath(), serializeAiToml(config), 'utf8');
}

export function envKeyForBrand(brand: AiBrandId, mode?: AiModeId): string {
  if (brand === 'grok' && mode === 'api') return GROK_API_ENV_KEY;
  return BRAND_ENV_KEYS[brand];
}

export function isAiEnvKey(key: string): boolean {
  return Object.values(BRAND_ENV_KEYS).includes(key) || key === GROK_API_ENV_KEY;
}

export async function setBrandSecret(brand: AiBrandId, value: string, mode?: AiModeId): Promise<void> {
  const envKey = envKeyForBrand(brand, mode);
  await setOsSecret(envKey, value);
  process.env[envKey] = value;
}

export async function getSecretForBrand(brand: AiBrandId, mode?: AiModeId): Promise<string> {
  const envKey = envKeyForBrand(brand, mode);
  return (await getOsSecret(envKey))?.trim() ?? '';
}

export async function getSecretByEnvKey(envKey: string): Promise<string> {
  return (await getOsSecret(envKey))?.trim() ?? '';
}

export async function saveBrandPreferences(
  brand: AiBrandId,
  prefs: AiBrandTomlConfig,
): Promise<AiTomlConfig> {
  const config = await readAiToml();
  config.providers[brand] = { ...config.providers[brand], ...prefs };
  await writeAiToml(config);
  return config;
}

export async function saveActiveAi(
  brand: AiBrandId,
  mode: AiModeId,
  model: string,
): Promise<AiTomlConfig> {
  const config = await readAiToml();
  config.active = { brand, mode, model };
  config.providers[brand] = { ...config.providers[brand], mode, model };
  await writeAiToml(config);
  return config;
}

export async function loadAiSecretsIntoEnv(): Promise<void> {
  const keys = [...Object.values(BRAND_ENV_KEYS), GROK_API_ENV_KEY];
  for (const envKey of keys) {
    const stored = (await getOsSecret(envKey))?.trim();
    if (stored) process.env[envKey] = stored;
  }
}

export async function loadAiTomlIntoEnv(): Promise<AiTomlConfig> {
  await loadAiSecretsIntoEnv();
  return readAiToml();
}

export async function migrateAiSecretsToOsStore(): Promise<void> {
  const config = await readAiToml();
  const envFile = await readEnvFile();
  for (const envKey of [...Object.values(BRAND_ENV_KEYS), GROK_API_ENV_KEY]) {
    const existing = (await getOsSecret(envKey))?.trim();
    if (existing) continue;
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
