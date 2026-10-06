import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildDiagnosticsReport,
  collectRecentLogs,
  countMinidumps,
  diagnosticsFileName,
  homeRelative,
  type DiagnosticsInput,
} from './export.js';

const home = process.platform === 'win32' ? 'C:\\Users\\kim' : '/home/kim';
const sep = process.platform === 'win32' ? '\\' : '/';

function input(overrides: Partial<DiagnosticsInput> = {}): DiagnosticsInput {
  return {
    generatedAt: new Date('2026-10-06T01:02:03Z'),
    app: { name: 'AX Studio', version: '0.1.0', packaged: true, locale: 'ko', uptimeSeconds: 12.4 },
    runtime: { electron: '44.5.1', node: '24.0.0' },
    os: { platform: 'win32', release: '10.0', arch: 'x64', totalMemoryMb: 16000, freeMemoryMb: 8000 },
    paths: { dataRoot: `${home}${sep}AppData${sep}AXStudio` },
    connectors: [{ connector: 'slack', connected: true }, { connector: 'gmail', connected: false }],
    crashes: { recentMainCrashes: [], minidumpCount: 2 },
    logs: [{ name: 'ax-studio-2026-10-06.log', text: 'INFO token=abc kim@example.com\n', truncated: false }],
    homeDirectory: home,
    ...overrides,
  };
}

describe('diagnostics report', () => {
  it('includes versions, connector flags and redacted logs without the home directory', () => {
    const report = buildDiagnosticsReport(input({
      logs: [{ name: 'a.log', text: `opened ${home}${sep}secret.pdf Authorization: Bearer xyz\n`, truncated: true }],
    }));
    expect(report).toContain('version: 0.1.0');
    expect(report).toContain('electron: 44.5.1');
    expect(report).toContain('slack: connected');
    expect(report).toContain('gmail: not connected');
    expect(report).toContain('minidumps: 2');
    expect(report).toContain(`dataRoot: ~${sep}AppData${sep}AXStudio`);
    expect(report).toContain('## Log a.log (tail)');
    expect(report).not.toContain(home);
    expect(report).not.toContain('xyz');
  });

  it('re-redacts log text', () => {
    const report = buildDiagnosticsReport(input());
    expect(report).toContain('token=***');
    expect(report).toContain('k***@example.com');
  });

  it('maps only paths under home', () => {
    expect(homeRelative(`${home}${sep}x`, home)).toBe(`~${sep}x`);
    expect(homeRelative(`${home}other${sep}x`, home)).toBe(`${home}other${sep}x`);
  });

  it('names the bundle with a UTC timestamp', () => {
    expect(diagnosticsFileName(new Date('2026-10-06T01:02:03.456Z'))).toBe('ax-studio-diagnostics-20261006-010203Z.txt');
  });
});

describe('collectRecentLogs', () => {
  it('reads newest files first within budget and returns them oldest first', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'ax-diag-'));
    try {
      writeFileSync(join(directory, 'ax-studio-2026-10-04.log'), 'old\n');
      writeFileSync(join(directory, 'ax-studio-2026-10-05.log'), 'line one\nline two\n');
      writeFileSync(join(directory, 'ax-studio-2026-10-06.log'), 'newest\n');
      writeFileSync(join(directory, 'crash-history.json'), '[]');
      const logs = await collectRecentLogs(directory, 'newest\n'.length + 'line two\n'.length + 2);
      expect(logs.map((log) => log.name)).toEqual(['ax-studio-2026-10-05.log', 'ax-studio-2026-10-06.log']);
      expect(logs[0]).toEqual({ name: 'ax-studio-2026-10-05.log', text: 'line two\n', truncated: true });
      expect(logs[1]).toEqual({ name: 'ax-studio-2026-10-06.log', text: 'newest\n', truncated: false });
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('returns nothing for a missing folder and counts minidumps recursively', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'ax-dumps-'));
    try {
      expect(await collectRecentLogs(join(directory, 'missing'))).toEqual([]);
      mkdirSync(join(directory, 'reports'), { recursive: true });
      writeFileSync(join(directory, 'reports', 'a.dmp'), '');
      writeFileSync(join(directory, 'b.DMP'), '');
      writeFileSync(join(directory, 'settings.dat'), '');
      expect(await countMinidumps(directory)).toBe(2);
      expect(await countMinidumps(join(directory, 'missing'))).toBe(0);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
