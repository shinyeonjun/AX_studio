import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { getAxDataPaths } from './ax-data.js';

export type AppLogLevel = 'info' | 'warn' | 'error';

const MAX_LINE_CHARS = 8_192;
let fileLogEnabled = false;

export function enableAppFileLog(): void {
  fileLogEnabled = true;
}

export function disableAppFileLog(): void {
  fileLogEnabled = false;
}

export function isAppFileLogEnabled(): boolean {
  return fileLogEnabled;
}

export function appLogFileName(now = new Date()): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `ax-studio-${year}-${month}-${day}.log`;
}

function serializeExtra(extra: Record<string, unknown> | undefined): string {
  if (!extra || Object.keys(extra).length === 0) return '';
  try {
    const json = JSON.stringify(extra, (_key, value) => {
      if (typeof value === 'string' && value.length > 1_024) return `${value.slice(0, 1_024)}…`;
      return value;
    });
    return json ? ` ${json}` : '';
  } catch {
    return '';
  }
}

export function appendAppLog(
  level: AppLogLevel,
  message: string,
  extra?: Record<string, unknown>,
): void {
  if (!fileLogEnabled) return;
  const text = String(message ?? '').replace(/\s+/g, ' ').trim();
  if (!text) return;
  try {
    const dir = getAxDataPaths().logs;
    mkdirSync(dir, { recursive: true });
    const line = `${new Date().toISOString()} ${level.toUpperCase()} ${text}${serializeExtra(extra)}\n`;
    appendFileSync(join(dir, appLogFileName()), line.slice(0, MAX_LINE_CHARS) + (line.length > MAX_LINE_CHARS ? '…\n' : ''), 'utf8');
  } catch {
    // File logging must never take down the app.
  }
}
