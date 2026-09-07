import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDatabaseAsync } from './db.js';
import { WorkflowStore } from './workflow-store.js';

describe('legacy database migrations', () => {
  it('enables foreign-key enforcement for every database backend', async () => {
    const db = await createDatabaseAsync(':memory:');
    try {
      expect((db.prepare('PRAGMA foreign_keys').get() as { foreign_keys?: number } | undefined)?.foreign_keys).toBe(1);
    } finally {
      db.close?.();
    }
  });

  it('renames executions.skill_id to workflow_id on existing databases', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'ax-legacy-db-'));
    const filePath = join(directory, 'ax-studio.db');
    try {
      const initSqlJs = (await import('sql.js')).default;
      const SQL = await initSqlJs();
      const legacy = new SQL.Database();
      legacy.run(`
        CREATE TABLE executions (
          id TEXT PRIMARY KEY,
          skill_id TEXT,
          skill_version INTEGER,
          ephemeral INTEGER NOT NULL DEFAULT 0,
          status TEXT NOT NULL,
          started_at TEXT NOT NULL,
          finished_at TEXT,
          error_code TEXT,
          log_json TEXT NOT NULL DEFAULT '[]',
          trigger_type TEXT,
          ir_json TEXT
        );
        INSERT INTO executions (id, skill_id, skill_version, ephemeral, status, started_at, log_json)
        VALUES ('exec-legacy', 'wf-legacy', 1, 0, 'success', '2026-08-01T00:00:00.000Z', '[]');
      `);
      writeFileSync(filePath, Buffer.from(legacy.export()));
      legacy.close();

      const db = await createDatabaseAsync(filePath);
      const columns = (db.prepare('PRAGMA table_info(executions)').all() as Array<{ name: string }>).map(
        (row) => row.name,
      );
      expect(columns).toContain('workflow_id');
      expect(columns).toContain('workflow_version');
      expect(columns).toContain('workspace_session_id');
      expect(columns).not.toContain('skill_id');
      expect(columns).not.toContain('skill_version');

      const store = new WorkflowStore(db);
      expect(store.listExecutions()).toEqual([
        expect.objectContaining({ id: 'exec-legacy', workflowId: 'wf-legacy', workflowVersion: 1 }),
      ]);
      expect(store.createExecution({ workflowId: 'wf-new', ephemeral: true })).toBeTruthy();
      db.close?.();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
