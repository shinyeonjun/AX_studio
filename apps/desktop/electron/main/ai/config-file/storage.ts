import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { app } from 'electron';
import type { AiBrand } from '@ax-studio/core';
import type {
  AiBrandTomlConfig,
  AiTomlConfig,
  JevDecisionTomlConfig,
} from './contracts.js';
import { emptyConfig, parseAiToml, serializeAiToml } from './toml.js';
import { getDesktopAxDataPaths } from '../../data-paths.js';

export function getAiConfigPath(): string {
  if (app.isPackaged || process.env.AX_PRODUCT_QA === '1' || process.env.AX_E2E === '1') {
    return join(getDesktopAxDataPaths().config, 'ai.toml');
  }
  return join(app.getAppPath(), '../../ai.toml');
}

export async function readAiToml(): Promise<AiTomlConfig> {
  const path = getAiConfigPath();
  if (!existsSync(path)) return emptyConfig();
  const content = await readFile(path, 'utf8');
  return parseAiToml(content);
}

export async function writeAiToml(config: AiTomlConfig): Promise<void> {
  const path = getAiConfigPath();
  const temporaryPath = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporaryPath, serializeAiToml(config), { encoding: 'utf8', mode: 0o600 });
    await rename(temporaryPath, path);
  } catch (error) {
    await unlink(temporaryPath).catch(() => undefined);
    throw error;
  }
}

export async function saveBrandPreferences(
  brand: AiBrand,
  prefs: AiBrandTomlConfig,
): Promise<AiTomlConfig> {
  const config = await readAiToml();
  config.providers[brand] = { ...config.providers[brand], ...prefs };
  await writeAiToml(config);
  return config;
}

export async function saveJevDecisionPreferences(
  prefs: JevDecisionTomlConfig,
): Promise<AiTomlConfig> {
  const config = await readAiToml();
  config.decision ??= {};
  config.decision.jev = { ...config.decision.jev, ...prefs };
  await writeAiToml(config);
  return config;
}

export async function saveActiveAi(
  brand: AiBrand,
  mode: 'cli' | 'api',
  model: string,
): Promise<AiTomlConfig> {
  const config = await readAiToml();
  config.active = { brand, mode, model };
  config.providers[brand] = { ...config.providers[brand], mode, model };
  await writeAiToml(config);
  return config;
}
