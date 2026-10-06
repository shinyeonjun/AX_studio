import { appendFileSync, mkdirSync, statSync } from 'node:fs';
import { appendFile, mkdir, readdir, rename, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { getAxDataPaths } from './ax-data.js';

export type AppLogLevel = 'info' | 'warn' | 'error';

const MAX_LINE_CHARS = 8_192;
const FLUSH_DELAY_MS = 250;
const MAX_BUFFERED_LINES = 5_000;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface AppLogRetention {
  /** Rotate the active daily file once it would grow past this many bytes. */
  maxFileBytes: number;
  /** Files kept per UTC day, including the active one. */
  maxFilesPerDay: number;
  /** Delete log files whose UTC date is older than this. */
  maxAgeDays: number;
}

const DEFAULT_APP_LOG_RETENTION: AppLogRetention = Object.freeze({
  maxFileBytes: 5 * 1024 * 1024,
  maxFilesPerDay: 5,
  maxAgeDays: 14,
});

const LOG_FILE_PATTERN = /^ax-studio-(\d{4}-\d{2}-\d{2})(?:\.(\d+))?\.log$/;

let fileLogEnabled = false;
let retention: AppLogRetention = DEFAULT_APP_LOG_RETENTION;
let buffer: string[] = [];
let droppedLines = 0;
let flushTimer: ReturnType<typeof setTimeout> | undefined;
let writeChain: Promise<void> = Promise.resolve();
let preparedDirectory: string | undefined;
let activeFile: { path: string; size: number } | undefined;
let prunedForDay: string | undefined;
let exitHookInstalled = false;

// ---------------------------------------------------------------------------
// Redaction
// ---------------------------------------------------------------------------

const SECRET_KEY = String.raw`[\w.-]*(?:password|passwd|pwd|secret|token|api[_-]?key|apikey|credential|credentials|cookie|private[_-]?key|session[_-]?id)`;
const KEY_VALUE_PATTERN = new RegExp(
  String.raw`(["']?)\b(${SECRET_KEY})\1(\s*[:=]\s*)("[^"]*"|'[^']*'|[^"'\s,;&}\]]+)`,
  'gi',
);
const NON_SECRET_VALUES = new Set(['true', 'false', 'null', 'undefined', '***', '[redacted]']);

const REDACTIONS: ReadonlyArray<readonly [RegExp, string | ((...args: string[]) => string)]> = [
  // Credentials embedded in connection strings / URLs: scheme://user:pass@host
  [/\b([a-z][a-z0-9+.-]*:\/\/)([^\s:@/'"]+):([^\s@/'"]+)@/gi, '$1$2:***@'],
  // Authorization header values, including "Basic <b64>" and "Bearer <token>".
  [/\b((?:proxy-)?authorization)(["']?\s*[:=]\s*["']?)([^"'\r\n,}]+)/gi, '$1$2***'],
  [/\bBearer\s+[A-Za-z0-9._~+/=-]+/g, 'Bearer ***'],
  // JWT-like (header.payload.signature, base64url)
  [/\beyJ[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]*/g, '[jwt]'],
  // Provider tokens
  [/\bxox[abposr]-[A-Za-z0-9-]+/g, 'xox*-***'],
  [/\bxapp-[A-Za-z0-9-]+/g, 'xapp-***'],
  [/\bsk-[A-Za-z0-9_-]{6,}/g, 'sk-***'],
  [/\bya29\.[A-Za-z0-9._-]+/g, 'ya29.***'],
  [/\b1\/\/0[A-Za-z0-9_-]{10,}/g, '1//***'],
  [/\bAIza[0-9A-Za-z_-]{20,}/g, 'AIza***'],
  [/\bgh[pousr]_[A-Za-z0-9]{16,}/g, 'gh*_***'],
  // password=..., "client_secret": "...", api_key: ...
  [KEY_VALUE_PATTERN, (match, quote, key, separator, value) => {
    const valueQuote = value[0] === '"' || value[0] === "'" ? value[0] : '';
    const inner = valueQuote ? value.slice(1, -1) : value;
    if (!inner || NON_SECRET_VALUES.has(inner.toLowerCase())) return match;
    return `${quote}${key}${quote}${separator}${valueQuote}***${valueQuote}`;
  }],
  // Query strings: keep parameter names, drop values.
  [/(\b[a-z][a-z0-9+.-]*:\/\/[^\s?#"'<>]*)\?([^\s#"'<>]+)/gi, (_match, base, query) =>
    `${base}?${query.split('&').map((part) => {
      const eq = part.indexOf('=');
      return eq < 0 ? part : `${part.slice(0, eq)}=***`;
    }).join('&')}`],
  // Email addresses: keep the first character of the local part and the domain.
  [/\b([A-Za-z0-9._%+-])[A-Za-z0-9._%+-]*@([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,})\b/g, '$1***@$2'],
];

/** Masks credentials, tokens, query values and email local parts in free-form log text. */
export function redactLogText(text: string): string {
  let result = text;
  for (const [pattern, replacement] of REDACTIONS) {
    pattern.lastIndex = 0;
    result = result.replace(pattern, replacement as (substring: string, ...args: string[]) => string);
  }
  return result;
}

// ---------------------------------------------------------------------------
// File naming / retention
// ---------------------------------------------------------------------------

function utcDay(now: Date): string {
  return now.toISOString().slice(0, 10);
}

/** Daily log name keyed by the UTC date, matching the ISO-8601 UTC line timestamps. */
export function appLogFileName(now = new Date()): string {
  return `ax-studio-${utcDay(now)}.log`;
}

function rotatedName(day: string, index: number): string {
  return index === 0 ? `ax-studio-${day}.log` : `ax-studio-${day}.${index}.log`;
}

export interface AppLogFileInfo {
  name: string;
  day: string;
  /** 0 for the active daily file, 1.. for older rotated chunks of the same day. */
  index: number;
}

function parseAppLogFileName(name: string): AppLogFileInfo | null {
  const match = LOG_FILE_PATTERN.exec(name);
  if (!match) return null;
  return { name, day: match[1]!, index: match[2] ? Number(match[2]) : 0 };
}

/** Newest first: by day descending, then active file before rotated chunks. */
export function sortAppLogFilesNewestFirst(names: string[]): AppLogFileInfo[] {
  return names
    .map(parseAppLogFileName)
    .filter((info): info is AppLogFileInfo => info !== null)
    .sort((a, b) => (a.day === b.day ? a.index - b.index : a.day < b.day ? 1 : -1));
}

/** Files that fall outside the age window or the per-day file budget. */
export function selectExpiredAppLogFiles(
  names: string[],
  now: Date,
  policy: AppLogRetention = retention,
): string[] {
  const cutoff = utcDay(new Date(now.getTime() - policy.maxAgeDays * DAY_MS));
  return sortAppLogFilesNewestFirst(names)
    .filter((info) => info.day < cutoff || info.index >= policy.maxFilesPerDay)
    .map((info) => info.name);
}

async function pruneLogDirectory(directory: string, now: Date): Promise<void> {
  const names = await readdir(directory).catch(() => [] as string[]);
  await Promise.all(
    selectExpiredAppLogFiles(names, now).map((name) => rm(join(directory, name), { force: true }).catch(() => {})),
  );
}

/** Shift `day.log -> day.1.log -> ... ` and drop the chunk beyond the per-day budget. */
async function rotateDailyFile(directory: string, day: string): Promise<void> {
  const last = retention.maxFilesPerDay - 1;
  if (last < 1) {
    await rm(join(directory, rotatedName(day, 0)), { force: true });
    return;
  }
  await rm(join(directory, rotatedName(day, last)), { force: true });
  for (let index = last - 1; index >= 0; index -= 1) {
    await rename(join(directory, rotatedName(day, index)), join(directory, rotatedName(day, index + 1)))
      .catch((error: NodeJS.ErrnoException) => {
        if (error.code !== 'ENOENT') throw error;
      });
  }
}

// ---------------------------------------------------------------------------
// Writer
// ---------------------------------------------------------------------------

export function enableAppFileLog(options: Partial<AppLogRetention> = {}): void {
  retention = { ...DEFAULT_APP_LOG_RETENTION, ...options };
  fileLogEnabled = true;
  if (!exitHookInstalled) {
    exitHookInstalled = true;
    // Last-chance synchronous flush so short-lived processes keep their tail.
    process.once('exit', () => flushAppLogSync());
  }
}

export function disableAppFileLog(): void {
  fileLogEnabled = false;
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = undefined;
  buffer = [];
  droppedLines = 0;
  preparedDirectory = undefined;
  activeFile = undefined;
  prunedForDay = undefined;
  retention = DEFAULT_APP_LOG_RETENTION;
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

function formatAppLogLine(
  level: AppLogLevel,
  message: string,
  extra?: Record<string, unknown>,
  now = new Date(),
): string | null {
  const text = String(message ?? '').replace(/\s+/g, ' ').trim();
  if (!text) return null;
  const raw = redactLogText(`${now.toISOString()} ${level.toUpperCase()} ${text}${serializeExtra(extra)}`);
  return raw.length > MAX_LINE_CHARS ? `${raw.slice(0, MAX_LINE_CHARS)}…\n` : `${raw}\n`;
}

function takeBuffer(): string {
  if (buffer.length === 0 && droppedLines === 0) return '';
  const lines = buffer;
  buffer = [];
  if (droppedLines > 0) {
    lines.push(`${new Date().toISOString()} WARN app log buffer overflow; ${droppedLines} line(s) dropped\n`);
    droppedLines = 0;
  }
  return lines.join('');
}

async function writeChunk(chunk: string): Promise<void> {
  const directory = getAxDataPaths().logs;
  const now = new Date();
  const day = utcDay(now);
  if (preparedDirectory !== directory) {
    await mkdir(directory, { recursive: true });
    preparedDirectory = directory;
    activeFile = undefined;
    prunedForDay = undefined;
  }
  if (prunedForDay !== day) {
    prunedForDay = day;
    await pruneLogDirectory(directory, now);
  }
  const path = join(directory, rotatedName(day, 0));
  if (activeFile?.path !== path) {
    const size = await stat(path).then((info) => info.size, () => 0);
    activeFile = { path, size };
  }
  const bytes = Buffer.byteLength(chunk, 'utf8');
  if (activeFile.size > 0 && activeFile.size + bytes > retention.maxFileBytes) {
    await rotateDailyFile(directory, day);
    activeFile = { path, size: 0 };
  }
  await appendFile(path, chunk, 'utf8');
  activeFile.size += bytes;
}

function scheduleFlush(): void {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = undefined;
    void flushAppLog();
  }, FLUSH_DELAY_MS);
  flushTimer.unref?.();
}

/** Writes all buffered lines; resolves once they are on disk (or dropped on I/O failure). */
export function flushAppLog(): Promise<void> {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = undefined;
  }
  const chunk = takeBuffer();
  if (chunk && fileLogEnabled) {
    writeChain = writeChain
      .then(() => writeChunk(chunk))
      .catch(() => {
        // File logging must never take down the app.
        activeFile = undefined;
        preparedDirectory = undefined;
      });
  }
  return writeChain;
}

/**
 * Synchronous flush for crash/exit paths where the event loop will not turn
 * again. Rotation is skipped; the next async write rotates if needed.
 */
export function flushAppLogSync(): void {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = undefined;
  }
  const chunk = takeBuffer();
  if (!chunk || !fileLogEnabled) return;
  try {
    const directory = getAxDataPaths().logs;
    mkdirSync(directory, { recursive: true });
    const path = join(directory, appLogFileName());
    appendFileSync(path, chunk, 'utf8');
    if (activeFile?.path === path) activeFile.size = statSync(path).size;
  } catch {
    // File logging must never take down the app.
  }
}

export function appendAppLog(
  level: AppLogLevel,
  message: string,
  extra?: Record<string, unknown>,
): void {
  if (!fileLogEnabled) return;
  try {
    const line = formatAppLogLine(level, message, extra);
    if (!line) return;
    if (buffer.length >= MAX_BUFFERED_LINES) {
      droppedLines += 1;
      return;
    }
    buffer.push(line);
    scheduleFlush();
  } catch {
    // File logging must never take down the app.
  }
}
