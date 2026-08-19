import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { app } from 'electron';

export function getEnvFilePath(): string {
  if (app.isPackaged) {
    return join(app.getPath('userData'), '.env');
  }
  return join(app.getAppPath(), '../../.env');
}

function parseEnvContent(content: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }
  return values;
}

function serializeEnv(values: Record<string, string>): string {
  const lines = [
    '# AX Studio local secrets',
    '# 개발: 프로젝트 루트 .env / 릴리즈: userData .env',
  ];
  for (const [key, value] of Object.entries(values)) {
    lines.push(`${key}=${value}`);
  }
  lines.push('');
  return lines.join('\n');
}

export async function loadEnvFile(): Promise<Record<string, string>> {
  const path = getEnvFilePath();
  if (!existsSync(path)) return {};
  const content = await readFile(path, 'utf8');
  const parsed = parseEnvContent(content);
  for (const [key, value] of Object.entries(parsed)) {
    process.env[key] = value;
  }
  return parsed;
}

export async function readEnvFile(): Promise<Record<string, string>> {
  const path = getEnvFilePath();
  if (!existsSync(path)) return {};
  const content = await readFile(path, 'utf8');
  return parseEnvContent(content);
}

export async function setEnvFileValue(key: string, value: string): Promise<void> {
  const path = getEnvFilePath();
  const current = await readEnvFile();
  current[key] = value;
  await writeFile(path, serializeEnv(current), 'utf8');
  process.env[key] = value;
}

export function maskSecret(value: string): string {
  if (!value) return '';
  if (value.length <= 8) return '••••••••';
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}
