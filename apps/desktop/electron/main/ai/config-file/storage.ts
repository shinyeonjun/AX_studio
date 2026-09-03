import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { app } from 'electron';
import type { AiBrand } from '@ax-studio/core';
import type { AiBrandTomlConfig, AiTomlConfig } from './contracts.js';
import { emptyConfig, parseAiToml, serializeAiToml } from './toml.js';
import { getDesktopAxDataPaths } from '../../data-paths.js';

export function getAiConfigPath(): string {
  if (app.isPackaged) {
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
  await writeFile(getAiConfigPath(), serializeAiToml(config), 'utf8');
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
