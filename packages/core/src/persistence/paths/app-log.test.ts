import { describe, expect, it, afterEach } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  appendAppLog,
  appLogFileName,
  disableAppFileLog,
  enableAppFileLog,
  flushAppLog,
  flushAppLogSync,
  redactLogText,
  selectExpiredAppLogFiles,
  sortAppLogFilesNewestFirst,
} from './app-log.js';
import { buildAxDataPaths, setAxDataPaths } from './ax-data.js';

function withLogDirectory(prefix: string, run: (directory: string) => Promise<void> | void) {
  return async () => {
    const directory = mkdtempSync(join(tmpdir(), prefix));
    try {
      setAxDataPaths(buildAxDataPaths(directory));
      await run(directory);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  };
}

describe('app file log', () => {
  afterEach(() => {
    disableAppFileLog();
    setAxDataPaths(null);
  });

  it('does not write until file logging is enabled', withLogDirectory('ax-log-off-', async (directory) => {
    appendAppLog('error', 'should not persist');
    await flushAppLog();
    expect(() => readFileSync(join(directory, 'logs', appLogFileName()), 'utf8')).toThrow();
  }));

  it('appends a daily log line under the data-root logs folder', withLogDirectory('ax-log-on-', async (directory) => {
    enableAppFileLog();
    appendAppLog('error', 'Agent timed out after 120000ms', { code: 'agent_timeout' });
    await flushAppLog();
    const body = readFileSync(join(directory, 'logs', appLogFileName()), 'utf8');
    expect(body).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z ERROR Agent timed out after 120000ms/);
    expect(body).toContain('"code":"agent_timeout"');
  }));

  it('buffers lines and writes them in order on flush', withLogDirectory('ax-log-buffer-', async (directory) => {
    enableAppFileLog();
    for (let index = 0; index < 50; index += 1) appendAppLog('info', `line ${index}`);
    expect(existsSync(join(directory, 'logs', appLogFileName()))).toBe(false);
    await flushAppLog();
    const lines = readFileSync(join(directory, 'logs', appLogFileName()), 'utf8').trim().split('\n');
    expect(lines).toHaveLength(50);
    expect(lines[0]).toMatch(/INFO line 0$/);
    expect(lines[49]).toMatch(/INFO line 49$/);
  }));

  it('flushes synchronously for crash paths', withLogDirectory('ax-log-sync-', (directory) => {
    enableAppFileLog();
    appendAppLog('error', 'fatal before exit');
    flushAppLogSync();
    expect(readFileSync(join(directory, 'logs', appLogFileName()), 'utf8')).toContain('ERROR fatal before exit');
  }));

  it('redacts every persisted line', withLogDirectory('ax-log-redact-', async (directory) => {
    enableAppFileLog();
    appendAppLog('warn', 'slack failed xoxb-1234-5678-abcdef', { authorization: 'Bearer abc.def', email: 'kim@example.com' });
    await flushAppLog();
    const body = readFileSync(join(directory, 'logs', appLogFileName()), 'utf8');
    expect(body).not.toContain('xoxb-1234');
    expect(body).not.toContain('abc.def');
    expect(body).not.toContain('kim@example.com');
    expect(body).toContain('k***@example.com');
  }));

  it('rotates the active file when it would exceed the size limit', withLogDirectory('ax-log-rotate-', async (directory) => {
    enableAppFileLog({ maxFileBytes: 200, maxFilesPerDay: 3 });
    const day = appLogFileName().slice('ax-studio-'.length, -'.log'.length);
    for (let round = 0; round < 6; round += 1) {
      appendAppLog('info', `round ${round} ${'x'.repeat(120)}`);
      await flushAppLog();
    }
    const files = readdirSync(join(directory, 'logs')).sort();
    expect(files).toEqual([`ax-studio-${day}.1.log`, `ax-studio-${day}.2.log`, `ax-studio-${day}.log`]);
    expect(readFileSync(join(directory, 'logs', `ax-studio-${day}.log`), 'utf8')).toContain('round 5');
    expect(readFileSync(join(directory, 'logs', `ax-studio-${day}.1.log`), 'utf8')).toContain('round 4');
    expect(readFileSync(join(directory, 'logs', `ax-studio-${day}.2.log`), 'utf8')).toContain('round 3');
  }));

  it('prunes files older than the retention window on first write of the day', withLogDirectory('ax-log-prune-', async (directory) => {
    const logs = join(directory, 'logs');
    mkdirSync(logs, { recursive: true });
    writeFileSync(join(logs, 'ax-studio-2000-01-01.log'), 'old\n');
    writeFileSync(join(logs, 'ax-studio-2000-01-01.3.log'), 'old\n');
    writeFileSync(join(logs, 'unrelated.txt'), 'keep\n');
    enableAppFileLog();
    appendAppLog('info', 'fresh');
    await flushAppLog();
    expect(readdirSync(logs).sort()).toEqual([appLogFileName(), 'unrelated.txt'].sort());
  }));
});

describe('log retention selection', () => {
  it('names files by UTC date', () => {
    expect(appLogFileName(new Date('2026-10-06T23:30:00-09:00'))).toBe('ax-studio-2026-10-07.log');
  });

  it('sorts newest day first and the active chunk before rotated chunks', () => {
    expect(sortAppLogFilesNewestFirst([
      'ax-studio-2026-10-05.log', 'ax-studio-2026-10-06.2.log', 'notes.txt', 'ax-studio-2026-10-06.log', 'ax-studio-2026-10-06.1.log',
    ]).map((file) => file.name)).toEqual([
      'ax-studio-2026-10-06.log', 'ax-studio-2026-10-06.1.log', 'ax-studio-2026-10-06.2.log', 'ax-studio-2026-10-05.log',
    ]);
  });

  it('expires by age and by per-day chunk budget', () => {
    const now = new Date('2026-10-20T12:00:00Z');
    expect(selectExpiredAppLogFiles([
      'ax-studio-2026-10-05.log', 'ax-studio-2026-10-06.log', 'ax-studio-2026-10-20.log',
      'ax-studio-2026-10-20.4.log', 'ax-studio-2026-10-20.5.log', 'other.log',
    ], now, { maxAgeDays: 14, maxFileBytes: 1, maxFilesPerDay: 5 }).sort()).toEqual([
      'ax-studio-2026-10-05.log', 'ax-studio-2026-10-20.5.log',
    ]);
  });
});

describe('redactLogText', () => {
  it.each([
    ['slack bot token xoxb-1111-2222-abcdEFG', 'xoxb-1111', 'xox*-***'],
    ['slack app token xapp-1-A0-123-abc', 'xapp-1-A0', 'xapp-***'],
    ['key sk-ant-api03-AbCdEf123456', 'sk-ant-api03', 'sk-***'],
    ['google ya29.a0AfH6SMBx-y_z', 'ya29.a0Af', 'ya29.***'],
    ['header Bearer abc.DEF-123', 'abc.DEF', 'Bearer ***'],
    ['Authorization: Basic dXNlcjpwYXNz', 'dXNlcjpwYXNz', 'Authorization: ***'],
    ['{"authorization":"Token abc"}', 'Token abc', '"authorization":"***'],
    ['jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJl', 'eyJhbGci', '[jwt]'],
    ['login password=hunter2 ok', 'hunter2', 'password=***'],
    ['{"client_secret":"s3cr3t value"}', 's3cr3t', '"client_secret":"***"'],
    ["api_key: 'abc123'", 'abc123', "api_key: '***'"],
    ['SLACK_SIGNING_SECRET=abcd1234', 'abcd1234', 'SLACK_SIGNING_SECRET=***'],
    ['refresh_token=1//0gAbCdEfGhIjKlMn', '1//0gAbCd', 'refresh_token=***'],
    ['postgres://admin:p4ss@db.local:5432/app', 'p4ss', 'postgres://admin:***@db.local:5432/app'],
    ['mysql://root:x@127.0.0.1/db', 'root:x@', 'mysql://root:***@127.0.0.1/db'],
    ['user kim.minsu@example.co.kr wrote', 'kim.minsu', 'k***@example.co.kr'],
    ['GET https://api.example.com/v1/items?key=AAA&page=2#top', 'AAA', 'https://api.example.com/v1/items?key=***&page=***#top'],
  ])('masks %s', (input, secret, expected) => {
    const output = redactLogText(input);
    expect(output).not.toContain(secret);
    expect(output).toContain(expected);
  });

  it('keeps ordinary diagnostics readable', () => {
    const line = 'Agent invocation completed {"inputTokens":1200,"maxTokens":4096,"hasSecret":true,"durationMs":42} at https://api.example.com/v1/';
    expect(redactLogText(line)).toBe(line);
  });
});
