import { existsSync } from 'node:fs';
import { chmod, copyFile, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { app } from 'electron';

/** .env — 개발 전용 (Gmail OAuth client). 릴리즈 빌드에서는 사용하지 않음. */
export const ENV_FILE_ALLOWED_KEYS = new Set([
  'GOOGLE_OAUTH_CLIENT_ID',
  'GOOGLE_OAUTH_CLIENT_SECRET',
]);

export function getEnvFilePath(): string {
  return join(app.getAppPath(), '../../.env');
}

function isDevEnvFileEnabled(): boolean {
  return !app.isPackaged;
}

function envLineKey(line: string): string | undefined {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) return undefined;
  const eq = trimmed.indexOf('=');
  if (eq <= 0) return undefined;
  return trimmed.slice(0, eq).trim();
}

function parseEnvContent(content: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const line of content.split(/\r?\n/)) {
    const key = envLineKey(line);
    if (key === undefined) continue;
    const trimmed = line.trim();
    let value = trimmed.slice(trimmed.indexOf('=') + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }
  return values;
}

/**
 * Drops only the lines that assign a non-allowlisted key. Comments, blank
 * lines, unparsable lines, allowed assignments and the original line endings
 * are kept verbatim.
 */
export function stripDisallowedEnvLines(
  content: string,
  allowed: ReadonlySet<string> = ENV_FILE_ALLOWED_KEYS,
): { content: string; removed: string[] } {
  const removed = new Set<string>();
  const kept = content.split(/(?<=\n)/).filter((line) => {
    const key = envLineKey(line);
    if (key === undefined || allowed.has(key)) return true;
    removed.add(key);
    return false;
  });
  return { content: kept.join(''), removed: [...removed] };
}

export async function loadEnvFile(): Promise<Record<string, string>> {
  if (!isDevEnvFileEnabled()) return {};
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
  if (!isDevEnvFileEnabled()) return {};
  const path = getEnvFilePath();
  if (!existsSync(path)) return {};
  const content = await readFile(path, 'utf8');
  return parseEnvContent(content);
}

/**
 * AI API 키 등 금지된 항목을 .env 파일에서 제거한다. 다시 쓰기 전에
 * `.env.bak`(소유자 전용 권한)으로 원본을 보관하고, 주석·기타 줄은 그대로 둔다.
 */
export async function purgeDisallowedEnvFileKeys(): Promise<string[]> {
  if (!isDevEnvFileEnabled()) return [];
  const path = getEnvFilePath();
  if (!existsSync(path)) return [];
  const original = await readFile(path, 'utf8');
  const { content, removed } = stripDisallowedEnvLines(original);
  if (removed.length === 0) return [];
  await copyFile(path, `${path}.bak`);
  await chmod(`${path}.bak`, 0o600).catch(() => {});
  await writeFile(path, content, 'utf8');
  for (const key of removed) {
    delete process.env[key];
  }
  console.warn(`[AX Studio] .env에서 허용되지 않은 항목 ${removed.length}개를 제거했습니다 (원본: .env.bak).`);
  return removed;
}

export function maskSecret(value: string): string {
  if (!value) return '';
  if (value.length <= 8) return '••••••••';
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}
