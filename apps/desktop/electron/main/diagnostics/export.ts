import { open, readdir, stat, writeFile } from 'node:fs/promises';
import { join, sep } from 'node:path';
import { redactLogText, sortAppLogFilesNewestFirst } from '@ax-studio/core';

/** Upper bound for log text copied into one diagnostics bundle. */
export const DIAGNOSTICS_LOG_BUDGET_BYTES = 2 * 1024 * 1024;

export interface DiagnosticsInput {
  generatedAt: Date;
  app: { name: string; version: string; packaged: boolean; locale: string; uptimeSeconds: number };
  runtime: Record<string, string | undefined>;
  os: { platform: string; release: string; arch: string; totalMemoryMb: number; freeMemoryMb: number };
  paths: Record<string, string>;
  connectors: Array<{ connector: string; connected: boolean }>;
  crashes: { recentMainCrashes: string[]; minidumpCount: number };
  logs: Array<{ name: string; text: string; truncated: boolean }>;
  homeDirectory: string;
}

/** Replaces the user's home directory so paths do not reveal the account name. */
export function homeRelative(path: string, homeDirectory: string): string {
  if (!homeDirectory) return path;
  const normalizedHome = homeDirectory.replace(/[\\/]+$/, '');
  if (path === normalizedHome) return '~';
  const lowerPath = process.platform === 'win32' ? path.toLowerCase() : path;
  const lowerHome = process.platform === 'win32' ? normalizedHome.toLowerCase() : normalizedHome;
  if (lowerPath.startsWith(`${lowerHome}${sep}`) || lowerPath.startsWith(`${lowerHome}/`)) {
    return `~${path.slice(normalizedHome.length)}`;
  }
  return path;
}

/** Reads the newest log files (newest first) until the byte budget is spent; returns them oldest first. */
export async function collectRecentLogs(
  directory: string,
  budgetBytes = DIAGNOSTICS_LOG_BUDGET_BYTES,
): Promise<DiagnosticsInput['logs']> {
  const names = await readdir(directory).catch(() => [] as string[]);
  const collected: DiagnosticsInput['logs'] = [];
  let remaining = budgetBytes;
  for (const { name } of sortAppLogFilesNewestFirst(names)) {
    if (remaining <= 0) break;
    const path = join(directory, name);
    const size = await stat(path).then((info) => info.size, () => 0);
    if (size === 0) continue;
    const length = Math.min(size, remaining);
    const handle = await open(path, 'r');
    try {
      const buffer = Buffer.alloc(length);
      await handle.read(buffer, 0, length, size - length);
      let text = buffer.toString('utf8');
      if (length < size) text = text.slice(text.indexOf('\n') + 1);
      collected.push({ name, text, truncated: length < size });
    } finally {
      await handle.close();
    }
    remaining -= length;
  }
  return collected.reverse();
}

export async function countMinidumps(directory: string): Promise<number> {
  try {
    const entries = await readdir(directory, { recursive: true });
    return entries.filter((entry) => entry.toLowerCase().endsWith('.dmp')).length;
  } catch {
    return 0;
  }
}

function section(title: string, lines: string[]): string {
  return [`## ${title}`, ...lines, ''].join('\n');
}

/** Plain-text bundle. Every line is passed through the log redactor again before it is written. */
export function buildDiagnosticsReport(input: DiagnosticsInput): string {
  const home = (path: string) => homeRelative(path, input.homeDirectory);
  const parts = [
    `# ${input.app.name} diagnostics`,
    `generatedAt: ${input.generatedAt.toISOString()}`,
    '',
    section('App', [
      `version: ${input.app.version}`,
      `packaged: ${input.app.packaged}`,
      `locale: ${input.app.locale}`,
      `uptimeSeconds: ${Math.round(input.app.uptimeSeconds)}`,
    ]),
    section('Runtime', Object.entries(input.runtime).map(([key, value]) => `${key}: ${value ?? 'unknown'}`)),
    section('OS', [
      `platform: ${input.os.platform} ${input.os.release} (${input.os.arch})`,
      `memoryMb: ${input.os.freeMemoryMb} free / ${input.os.totalMemoryMb} total`,
    ]),
    section('Paths', Object.entries(input.paths).map(([key, value]) => `${key}: ${home(value)}`)),
    section('Connectors', input.connectors.length === 0
      ? ['(none or core not initialized)']
      : input.connectors.map(({ connector, connected }) => `${connector}: ${connected ? 'connected' : 'not connected'}`)),
    section('Crashes', [
      `minidumps: ${input.crashes.minidumpCount}`,
      `recentMainCrashes: ${input.crashes.recentMainCrashes.length ? input.crashes.recentMainCrashes.join(', ') : 'none'}`,
    ]),
    ...input.logs.map((log) => section(
      `Log ${log.name}${log.truncated ? ' (tail)' : ''}`,
      [log.text.replace(/\s+$/, '')],
    )),
  ];
  return redactHomeAndSecrets(parts.join('\n'), input.homeDirectory);
}

function redactHomeAndSecrets(text: string, homeDirectory: string): string {
  // Per line, like the log writer, so a stray quote cannot mask across lines.
  const redacted = text.split('\n').map(redactLogText).join('\n');
  if (!homeDirectory) return redacted;
  const escaped = homeDirectory.replace(/[\\/]+$/, '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return redacted.replace(new RegExp(escaped, process.platform === 'win32' ? 'gi' : 'g'), '~');
}

export async function writeDiagnosticsReport(path: string, report: string): Promise<void> {
  await writeFile(path, report, 'utf8');
}

export function diagnosticsFileName(now: Date): string {
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\..+$/, '').replace('T', '-');
  return `ax-studio-diagnostics-${stamp}Z.txt`;
}
