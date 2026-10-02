import { createNativeDatabase } from '../../db-native.js';
import type { AppDatabase } from '../../db.js';
import { INITIAL_SCHEMA_SQL } from './preview-0ba5e22/schema.fixture.js';
import * as preview from './preview-0ba5e22/writer.fixture.js';

// Only synthetic values. The schema, v1 validator and SQL writers above are frozen
// from 0ba5e22f54cc9fe2bb777f085290bb03de5f457b; current migrations run only on reopen.
export function createPreviewFixture(filePath: string) {
  const db = createNativeDatabase(filePath);
  try {
    db.exec(INITIAL_SCHEMA_SQL);
    const output = { version: 1 as const, fields: [
      { path: 'steps.total.output.amount', label: 'Synthetic total', valueJson: '42' },
    ] };
    const checkpoint = [{ at: '2026-09-01T00:00:00.000Z', level: 'info',
      code: 'step_started', message: 'Synthetic calculation started', data: { stepId: 'total' } }];
    const tail = { at: '2026-09-01T00:00:01.000Z', level: 'info',
      code: 'step_completed', message: 'Synthetic calculation completed', data: { stepId: 'total' } };
    const waiting = { at: '2026-09-01T00:00:02.000Z', level: 'warn',
      code: 'waiting_approval', message: 'Synthetic approval pending', data: { stepId: 'send' } };
    const completedId = preview.createExecution(db, { ephemeral: true, workspaceSessionId: 'synthetic-chat' });
    preview.finishExecution(db, completedId, 'success', undefined, [...checkpoint, tail], output);
    const interruptedId = preview.createExecution(db, { ephemeral: true });
    preview.updateExecutionLog(db, interruptedId, checkpoint);
    preview.appendExecutionLog(db, interruptedId, tail);
    // Identical events at different sequences are distinct evidence, never deduplicated.
    preview.appendExecutionLog(db, interruptedId, tail);
    const pendingId = preview.createExecution(db, { ephemeral: true });
    preview.markExecutionPending(db, pendingId, 'pending_approval', checkpoint);
    preview.appendExecutionLog(db, pendingId, waiting);
    db.prepare('INSERT INTO approvals (id, execution_id, action_ids_json, reason, created_at, payload_json) VALUES (?, ?, ?, ?, ?, ?)')
      .run('synthetic-approval', pendingId, '["send"]', 'Synthetic approval', '2026-09-01T00:00:02.000Z', '{"synthetic":true}');
    const messages = [{ role: 'user', content: 'Synthetic request' },
      { role: 'assistant', kind: 'execution_result', content: 'Synthetic total: 42', executionId: completedId, executionStatus: 'success' }];
    db.prepare('INSERT INTO workspace_chats (id, title, messages_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
      .run('synthetic-chat', 'Synthetic history', JSON.stringify(messages), '2026-09-01T00:00:00.000Z', '2026-09-01T00:00:03.000Z');
    db.prepare('INSERT INTO settings VALUES (?, ?)').run('synthetic-setting', '{"enabled":false,"count":0}');
    return { completedId, interruptedId, pendingId, output, checkpoint, tail, waiting, messages };
  } finally {
    db.close?.();
  }
}

export function rawPreviewEvidence(db: AppDatabase) {
  return {
    executions: db.prepare('SELECT id, status, finished_at, error_code, hex(log_json) AS checkpoint, hex(output_json) AS output FROM executions ORDER BY id').all(),
    tail: db.prepare('SELECT sequence, execution_id, hex(entry_json) AS entry FROM execution_log_entries ORDER BY sequence').all(),
    approvals: db.prepare('SELECT * FROM approvals ORDER BY id').all(),
    chats: db.prepare('SELECT id, hex(messages_json) AS messages FROM workspace_chats ORDER BY id').all(),
    settings: db.prepare('SELECT key, hex(value_json) AS value FROM settings ORDER BY key').all(),
  };
}
