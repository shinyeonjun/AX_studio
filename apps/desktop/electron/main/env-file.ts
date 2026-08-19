import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { app } from 'electron';

/** .env에 둘 수 있는 값 — 개발용 OAuth 등. AI API 키는 OS credential store 전용. */
export const ENV_FILE_ALLOWED_KEYS = new Set([
  'GOOGLE_OAUTH_CLIENT_ID',
  'GOOGLE_OAUTH_CLIENT_SECRET',
]);

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
    '# AX Studio — 개발/릴리즈 로컬 설정',
    '# AI API 키는 이 파일에 넣지 마세요. 앱 설정 → OS 자격 증명에 암호화 저장됩니다.',
    '',
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
    if (!ENV_FILE_ALLOWED_KEYS.has(key)) continue;
    if (!value.trim()) continue;
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
  if (!ENV_FILE_ALLOWED_KEYS.has(key)) {
    throw new Error(`${key}는 .env에 저장할 수 없습니다. 앱 설정에서 등록하세요.`);
  }
  const path = getEnvFilePath();
  const current = await readEnvFile();
  current[key] = value;
  await writeFile(path, serializeEnv(current), 'utf8');
  process.env[key] = value;
}

/** AI API 키 등 금지된 항목을 .env 파일에서 제거한다. */
export async function purgeDisallowedEnvFileKeys(): Promise<string[]> {
  const path = getEnvFilePath();
  if (!existsSync(path)) return [];
  const current = await readEnvFile();
  const removed = Object.keys(current).filter((key) => !ENV_FILE_ALLOWED_KEYS.has(key));
  if (removed.length === 0) return [];
  const kept = Object.fromEntries(
    Object.entries(current).filter(([key]) => ENV_FILE_ALLOWED_KEYS.has(key)),
  );
  await writeFile(path, serializeEnv(kept), 'utf8');
  for (const key of removed) {
    delete process.env[key];
  }
  return removed;
}

export function maskSecret(value: string): string {
  if (!value) return '';
  if (value.length <= 8) return '••••••••';
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}
