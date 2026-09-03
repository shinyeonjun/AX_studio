import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { probeRdbConnection } from './config.js';
import { createSqliteCustomersFixture } from './sqlite-test-fixture.js';

describe('probeRdbConnection', () => {
  it('probes a readable sqlite file and rejects a missing file', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ax-rdb-config-'));
    try {
      const missing = await probeRdbConnection({ type: 'sqlite', filePath: join(root, 'missing.sqlite') });
      expect(missing.ok).toBe(false);
      if (!missing.ok) expect(missing.error).toBe('sqlite_file_unreadable');

      const fixture = await createSqliteCustomersFixture();
      try {
        const probe = await probeRdbConnection({ type: 'sqlite', filePath: fixture.filePath });
        expect(probe).toEqual({ ok: true });
      } finally {
        fixture.cleanup();
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
