import { createNativeDatabase } from '../../db-native.js';
import type { AppDatabase } from '../../db.js';
import { applyMigrations } from '../../db/schema.js';
import { createSqlJsDatabase } from '../../db/sqljs.js';
import { createPreviewFixture } from './preview-upgrade.fixture.js';
import { appendExecutionLog } from './preview-0ba5e22/writer.fixture.js';

export const INVALID_PREVIEW_HISTORIES = [
  'malformed_checkpoint', 'malformed_tail', 'unsupported_tail', 'tail_count_limit', 'tail_byte_limit',
] as const;
export type PreviewHistoryCondition = typeof INVALID_PREVIEW_HISTORIES[number] | 'valid';

/** Corruption is seeded only in newly created synthetic preview files. */
export function createPreviewApprovalFixture(filePath: string, condition: PreviewHistoryCondition) {
  const fixture = createPreviewFixture(filePath);
  const db = createNativeDatabase(filePath);
  try {
    db.prepare('UPDATE executions SET ir_json = ?, output_json = ? WHERE id = ?').run(JSON.stringify({
      name: 'Synthetic approval', goal: 'Synthetic only', steps: [], permissions: {}, approval: [], allowExternalAuto: true,
    }), JSON.stringify(fixture.output), fixture.pendingId);
    db.prepare('UPDATE approvals SET action_ids_json = ? WHERE id = ?').run('[]', 'synthetic-approval');
    if (condition === 'malformed_checkpoint') {
      db.prepare('UPDATE executions SET log_json = ? WHERE id = ?').run('{broken', fixture.pendingId);
      appendExecutionLog(db, fixture.pendingId, fixture.waiting);
    } else if (condition === 'malformed_tail') {
      db.prepare('UPDATE execution_log_entries SET entry_json = ? WHERE execution_id = ?').run('[null]', fixture.pendingId);
    } else if (condition === 'unsupported_tail') {
      db.exec('ALTER TABLE execution_log_entries RENAME COLUMN entry_json TO legacy_entry_json');
    } else if (condition === 'tail_count_limit') {
      db.exec('BEGIN');
      try {
        for (let index = 0; index < 10_000; index++) appendExecutionLog(db, fixture.pendingId, fixture.waiting);
        db.exec('COMMIT');
      } catch (error) { db.exec('ROLLBACK'); throw error; }
    } else if (condition === 'tail_byte_limit') {
      appendExecutionLog(db, fixture.pendingId, { ...fixture.waiting, data: { padding: 'x'.repeat(4_194_304) } });
    }
    return { ...fixture, approvalId: 'synthetic-approval' };
  } finally { db.close?.(); }
}

export async function openCurrentPreviewHistory(filePath: string, backend: 'native' | 'sqljs') {
  if (backend === 'sqljs') return createSqlJsDatabase(filePath);
  const db = createNativeDatabase(filePath);
  applyMigrations(db);
  return db;
}

/** Excludes intentional lifecycle status/timestamp changes; compares all original payload bytes. */
export function previewApprovalHistoryBytes(db: AppDatabase) {
  const unsupported = db.prepare('PRAGMA table_info(execution_log_entries)').all()
    .some(column => column.name === 'legacy_entry_json');
  return {
    executions: db.prepare('SELECT id, hex(log_json) AS checkpoint, hex(output_json) AS output, hex(ir_json) AS snapshot FROM executions ORDER BY id').all(),
    tail: db.prepare(`SELECT sequence, execution_id, hex(${unsupported ? 'legacy_entry_json' : 'entry_json'}) AS entry
      FROM execution_log_entries ORDER BY sequence`).all(),
  };
}
