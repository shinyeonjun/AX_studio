import { describe, expect, it, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  appendAppLog,
  appLogFileName,
  disableAppFileLog,
  enableAppFileLog,
} from './app-log.js';
import { buildAxDataPaths, setAxDataPaths } from './ax-data.js';

describe('app file log', () => {
  afterEach(() => {
    disableAppFileLog();
    setAxDataPaths(null);
  });

  it('does not write until file logging is enabled', () => {
    const directory = mkdtempSync(join(tmpdir(), 'ax-log-off-'));
    try {
      setAxDataPaths(buildAxDataPaths(directory));
      appendAppLog('error', 'should not persist');
      expect(() => readFileSync(join(directory, 'logs', appLogFileName()), 'utf8')).toThrow();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('appends a daily log line under the data-root logs folder', () => {
    const directory = mkdtempSync(join(tmpdir(), 'ax-log-on-'));
    try {
      setAxDataPaths(buildAxDataPaths(directory));
      enableAppFileLog();
      appendAppLog('error', 'Agent timed out after 120000ms', { code: 'agent_timeout' });
      const body = readFileSync(join(directory, 'logs', appLogFileName()), 'utf8');
      expect(body).toMatch(/ERROR Agent timed out after 120000ms/);
      expect(body).toContain('"code":"agent_timeout"');
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
