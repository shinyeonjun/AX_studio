import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { createSqlJsDatabase, openReadonlySqlJs } from './sqljs.js';

describe('sql.js database persistence', () => {
  it('persists migrations before returning a file-backed database', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ax-sqljs-'));
    const path = join(root, 'database.sqlite');
    const db = await createSqlJsDatabase(path);

    try {
      expect(existsSync(path)).toBe(true);
      const readonly = await openReadonlySqlJs(path);
      try {
        expect(readonly.all("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'workflows'")).toHaveLength(1);
      } finally {
        readonly.close();
      }
    } finally {
      db.close();
      rmSync(root, { recursive: true, force: true });
    }
  });
});
