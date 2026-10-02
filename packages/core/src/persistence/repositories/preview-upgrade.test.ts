import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createNativeDatabase } from '../db-native.js';
import { applyMigrations } from '../db/schema.js';
import { createSqlJsDatabase } from '../db/sqljs.js';
import type { AppDatabase } from '../db.js';
import { WorkflowStore } from '../workflow-store.js';
import { createPreviewFixture, rawPreviewEvidence } from './fixtures/preview-upgrade.fixture.js';
import { appendExecutionLog } from './fixtures/preview-0ba5e22/writer.fixture.js';
import { parseExecutionOutput as previewParseOutput } from './fixtures/preview-0ba5e22/execution-output.fixture.js';

describe.each(['native', 'sqljs'] as const)('preview upgrade (%s)', (backend) => {
  let directory: string;
  let filePath: string;
  let db: AppDatabase;
  let store: WorkflowStore;
  let fixture: ReturnType<typeof createPreviewFixture>;
  let evidence: ReturnType<typeof rawPreviewEvidence>;

  async function openCurrent() {
    if (backend === 'sqljs') db = await createSqlJsDatabase(filePath);
    else { db = createNativeDatabase(filePath); applyMigrations(db); }
    store = new WorkflowStore(db);
  }

  beforeEach(async () => {
    directory = mkdtempSync(join(tmpdir(), 'ax-preview-compat-'));
    filePath = join(directory, 'synthetic.db');
    fixture = createPreviewFixture(filePath);
    const previewDb = createNativeDatabase(filePath);
    try { evidence = rawPreviewEvidence(previewDb); } finally { previewDb.close?.(); }
    await openCurrent();
  });

  afterEach(() => { db?.close?.(); rmSync(directory, { recursive: true, force: true }); });

  async function acrossReopens(check: () => void) {
    for (let opening = 0; opening < 3; opening++) {
      check();
      expect(rawPreviewEvidence(db)).toEqual(evidence);
      if (opening < 2) { db.close?.(); await openCurrent(); }
    }
  }

  async function seedHistoricalBytes(column: 'log_json' | 'output_json', id: string, value: string | Buffer) {
    db.close?.();
    const writer = createNativeDatabase(filePath);
    try {
      writer.prepare(`UPDATE executions SET ${column} = ? WHERE id = ?`).run(value, id);
      if (column === 'log_json') appendExecutionLog(writer, id, fixture.tail);
    } finally { writer.close?.(); }
    await openCurrent();
    evidence = rawPreviewEvidence(db);
  }

  it('restores the completed v1 output without rewriting the historical bytes', async () => {
    await acrossReopens(() => {
      expect(store.getExecution(fixture.completedId)).toHaveProperty('output', fixture.output);
    });
  });

  it('merges the interrupted checkpoint and ordered tail, retaining duplicate events', async () => {
    await acrossReopens(() => {
      const expected = [...fixture.checkpoint, fixture.tail, fixture.tail];
      expect(JSON.parse(store.getExecution(fixture.interruptedId)!.logJson)).toEqual(expected);
      expect(JSON.parse(store.listExecutions().find(e => e.id === fixture.interruptedId)!.logJson)).toEqual(expected);
      expect(store.getExecution(fixture.interruptedId)?.status).toBe('running');
    });
  });

  it('restores the pending tail while preserving resumable approval state', async () => {
    await acrossReopens(() => {
      expect(JSON.parse(store.getExecution(fixture.pendingId)!.logJson)).toEqual([...fixture.checkpoint, fixture.waiting]);
      expect(store.getExecution(fixture.pendingId)).toMatchObject({ status: 'pending_approval', finishedAt: null, errorCode: 'pending_approval' });
    });
  });

  it('control: keeps the chat and settings readable', async () => {
    await acrossReopens(() => {
      expect(store.getWorkspaceChat('synthetic-chat')?.messages).toEqual(fixture.messages);
      expect(store.getSetting('synthetic-setting', null)).toEqual({ enabled: false, count: 0 });
    });
  });

  it('control: keeps the pending approval readable', async () => {
    await acrossReopens(() => {
      expect(store.getPendingApprovals()).toMatchObject([{ id: 'synthetic-approval', executionId: fixture.pendingId,
        status: 'pending', actionIds: ['send'], payload: { synthetic: true } }]);
    });
  });

  it('keeps result bodies out of the default list and reads them lazily without loading logs/IR', () => {
    const exec = vi.spyOn(db, 'exec');
    const prepare = vi.spyOn(db, 'prepare');
    expect(store.listExecutions().find(e => e.id === fixture.completedId)).toMatchObject({ hasOutput: true, output: undefined });
    const listQuery = prepare.mock.calls.find(([sql]) => sql.includes('FROM executions ORDER BY'))?.[0];
    expect(listQuery).toContain('NULL AS output_json');
    expect(listQuery).not.toContain('length(output_json)');
    prepare.mockClear();
    expect(store.getExecutionOutput(fixture.completedId)).toEqual(fixture.output);
    const query = prepare.mock.calls.find(([sql]) => sql.includes('FROM executions WHERE'))?.[0];
    expect(query).not.toMatch(/log_json|ir_json|SELECT \*/);
    expect(prepare.mock.calls.some(([sql]) => sql.includes('FROM execution_log_entries'))).toBe(false);
    expect(exec).not.toHaveBeenCalled();
    expect(store.listExecutions(50, true).find(e => e.id === fixture.completedId)?.output).toEqual(fixture.output);
    expect(rawPreviewEvidence(db)).toEqual(evidence);
  });

  it.each(['failed', 'cancelled', 'running', 'pending_approval'])('never promotes an output on %s to success evidence', async (status) => {
    db.prepare('UPDATE executions SET status = ? WHERE id = ?').run(status, fixture.completedId);
    evidence = rawPreviewEvidence(db);
    await acrossReopens(() => {
      expect(store.getExecution(fixture.completedId)).toMatchObject({ status, hasOutput: false, output: undefined,
        historyDiagnostics: [{ code: 'execution_output_status_mismatch', source: 'output' }] });
      expect(() => store.getExecutionOutput(fixture.completedId)).toThrow('execution_output_unavailable');
    });
  });

  it.each(['{', 'null', '[]', '{"version":2,"fields":[]}',
    '{"version":1,"fields":[{"path":"value","valueJson":"not JSON"}]}'])('diagnoses malformed/unknown output %s and preserves its bytes', async (raw) => {
    db.prepare('UPDATE executions SET output_json = ? WHERE id = ?').run(raw, fixture.completedId);
    evidence = rawPreviewEvidence(db);
    await acrossReopens(() => {
      expect(store.getExecution(fixture.completedId)).toMatchObject({ output: undefined, hasOutput: true,
        historyDiagnostics: [{ code: 'invalid_execution_output', source: 'output' }] });
      expect(() => store.getExecutionOutput(fixture.completedId)).toThrow('invalid_execution_output');
    });
  });

  it('retains the preview Unicode contract above 256 KiB in UTF-8 bytes', async () => {
    const output = { version: 1, fields: Array.from({ length: 4 }, (_, i) => ({ path: `unicode-${i}`, valueJson: JSON.stringify('한'.repeat(59_000)) })) };
    const raw = JSON.stringify(output);
    expect(raw.length).toBeLessThan(262_144);
    expect(Buffer.byteLength(raw)).toBeGreaterThan(262_144);
    expect(previewParseOutput(raw)).toEqual(output);
    db.prepare('UPDATE executions SET output_json = ? WHERE id = ?').run(raw, fixture.completedId);
    evidence = rawPreviewEvidence(db);
    await acrossReopens(() => { expect(store.getExecutionOutput(fixture.completedId)).toEqual(output); });
  });

  it('accepts exactly the preview character limit and rejects the next character without rewriting', async () => {
    const base = JSON.stringify({ ...fixture.output, padding: '' });
    const raw = JSON.stringify({ ...fixture.output, padding: 'x'.repeat(262_144 - base.length) });
    expect(raw.length).toBe(262_144);
    expect(previewParseOutput(raw)).toEqual(fixture.output);
    db.prepare('UPDATE executions SET output_json = ? WHERE id = ?').run(raw, fixture.completedId);
    expect(store.getExecutionOutput(fixture.completedId)).toEqual(fixture.output);
    db.prepare('UPDATE executions SET output_json = ? WHERE id = ?').run(raw + ' ', fixture.completedId);
    evidence = rawPreviewEvidence(db);
    await acrossReopens(() => {
      expect(() => store.getExecutionOutput(fixture.completedId)).toThrow('execution_output_limit_exceeded');
      expect(store.getExecution(fixture.completedId)?.historyDiagnostics).toEqual([{ code: 'execution_output_limit_exceeded', source: 'output' }]);
    });
  });

  it('does not materialize oversized output hidden after an embedded NUL', async () => {
    const raw = '{"version":1}' + '\0' + 'x'.repeat(1_048_576);
    // sql.js string binding truncates at NUL. Seed the historical bytes with
    // native SQLite so both readers face the same actual on-disk evidence.
    db.close?.();
    const writer = createNativeDatabase(filePath);
    try { writer.prepare('UPDATE executions SET output_json = ? WHERE id = ?').run(raw, fixture.completedId); }
    finally { writer.close?.(); }
    await openCurrent();
    const rows: Record<string, unknown>[] = [];
    const prepare = db.prepare.bind(db);
    const spy = vi.spyOn(db, 'prepare').mockImplementation(sql => {
      const statement = prepare(sql);
      if (!sql.includes('AS output_byte_length')) return statement;
      return { ...statement, get(...params) {
        const row = statement.get(...params);
        if (row) rows.push(row);
        return row;
      } };
    });
    try { expect(() => store.getExecutionOutput(fixture.completedId)).toThrow('execution_output_limit_exceeded'); }
    finally { spy.mockRestore(); }
    expect(rows).toHaveLength(1);
    expect(rows[0]?.output_json).toBeNull();
    expect(db.prepare('SELECT hex(output_json) AS bytes FROM executions WHERE id = ?').get(fixture.completedId)?.bytes)
      .toBe(Buffer.from(raw).toString('hex').toUpperCase());
  });

  it.each(['nul', 'bom', 'invalid-utf8'] as const)('rejects %s output bytes instead of parsing a truncated or normalized prefix', async kind => {
    const json = JSON.stringify(fixture.output);
    const raw = kind === 'nul' ? json + '\0ignored suffix' : kind === 'bom' ? '\uFEFF' + json : Buffer.from([0xff, 0x7b, 0x7d]);
    await seedHistoricalBytes('output_json', fixture.completedId, raw);
    await acrossReopens(() => {
      expect(() => store.getExecutionOutput(fixture.completedId)).toThrow('invalid_execution_output');
      expect(store.getExecution(fixture.completedId)).toMatchObject({ output: undefined,
        historyDiagnostics: [{ code: 'invalid_execution_output', source: 'output' }] });
    });
  });

  it.each(['nul', 'bom', 'invalid-utf8'] as const)('diagnoses %s checkpoint bytes without accepting a valid prefix', async kind => {
    const json = JSON.stringify(fixture.checkpoint);
    const raw = kind === 'nul' ? json + '\0ignored suffix' : kind === 'bom' ? '\uFEFF' + json : Buffer.from([0xff, 0x5b, 0x5d]);
    await seedHistoricalBytes('log_json', fixture.interruptedId, raw);
    await acrossReopens(() => {
      const execution = store.getExecution(fixture.interruptedId)!;
      expect(execution.historyDiagnostics).toEqual([{ code: 'invalid_log_checkpoint', source: 'log_checkpoint' }]);
      expect(Array.isArray(JSON.parse(execution.logJson))).toBe(false);
      expect(JSON.parse(execution.logJson).checkpointJson).toEqual(typeof raw === 'string' ? raw : { bytesHex: raw.toString('hex') });
    });
  });

  it('retains global sequence gaps and clock skew without reordering or mixing executions', () => {
    const earlier = { ...fixture.tail, at: '2020-01-01T00:00:00Z', message: 'Clock moved backwards' };
    appendExecutionLog(db, fixture.pendingId, fixture.waiting);
    appendExecutionLog(db, fixture.interruptedId, earlier);
    expect(JSON.parse(store.getExecution(fixture.interruptedId)!.logJson))
      .toEqual([...fixture.checkpoint, fixture.tail, fixture.tail, earlier]);
  });

  it('preserves a corrupt checkpoint and its tail as raw evidence, without inventing log entries', async () => {
    const raw = '{synthetic corrupt checkpoint';
    db.prepare('UPDATE executions SET log_json = ? WHERE id = ?').run(raw, fixture.interruptedId);
    appendExecutionLog(db, fixture.interruptedId, fixture.tail);
    evidence = rawPreviewEvidence(db);
    await acrossReopens(() => {
      const execution = store.getExecution(fixture.interruptedId)!;
      expect(execution.historyDiagnostics).toEqual([{ code: 'invalid_log_checkpoint', source: 'log_checkpoint' }]);
      expect(JSON.parse(execution.logJson)).toMatchObject({ checkpointJson: raw,
        tail: [{ entry_json: JSON.stringify(fixture.tail) }] });
      expect(Array.isArray(JSON.parse(execution.logJson))).toBe(false);
    });
  });

  it.each(['{', 'null', '[1]', '{"message":"unknown entry shape"}'])('preserves malformed/unknown tail %s and its exact sequence', async (raw) => {
    db.prepare('INSERT INTO execution_log_entries (execution_id, entry_json) VALUES (?, ?)').run(fixture.interruptedId, raw);
    evidence = rawPreviewEvidence(db);
    await acrossReopens(() => {
      const execution = store.getExecution(fixture.interruptedId)!;
      expect(execution.historyDiagnostics).toEqual([{ code: 'invalid_log_entry', source: 'log_tail', sequence: expect.any(Number) }]);
      expect(JSON.parse(execution.logJson).tail.at(-1)).toEqual({ sequence: execution.historyDiagnostics[0]!.sequence, entry_json: raw });
      expect(execution.status).toBe('running');
    });
  });

  it('bounds an excessive tail without reading bodies or treating a prefix as a complete log', () => {
    db.exec('BEGIN');
    try {
      const insert = db.prepare('INSERT INTO execution_log_entries (execution_id, entry_json) VALUES (?, ?)');
      for (let i = 0; i < 10_001; i++) insert.run(fixture.interruptedId, JSON.stringify(fixture.tail));
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
    evidence = rawPreviewEvidence(db);
    const prepare = vi.spyOn(db, 'prepare');
    const execution = store.getExecution(fixture.interruptedId)!;
    expect(execution.historyDiagnostics).toEqual([{ code: 'execution_log_limit_exceeded', source: 'log_tail' }]);
    expect(JSON.parse(execution.logJson)).toMatchObject({ tailUnavailable: true });
    expect(prepare.mock.calls.some(([sql]) => /SELECT\s+sequence,/.test(sql))).toBe(false);
    expect(rawPreviewEvidence(db)).toEqual(evidence);
  });

  it('diagnoses an unknown tail schema without modifying or guessing its format', () => {
    db.exec('ALTER TABLE execution_log_entries RENAME COLUMN entry_json TO future_entry');
    const before = db.prepare('SELECT * FROM execution_log_entries ORDER BY sequence').all();
    expect(store.getExecution(fixture.interruptedId)?.historyDiagnostics).toEqual([{ code: 'unsupported_log_schema', source: 'log_tail' }]);
    expect(db.prepare('SELECT * FROM execution_log_entries ORDER BY sequence').all()).toEqual(before);
  });

  it('propagates SQLite read errors instead of pretending an empty valid history', () => {
    const prepare = db.prepare.bind(db);
    const spy = vi.spyOn(db, 'prepare').mockImplementation(sql => {
      if (sql.includes('SELECT COUNT(*)')) throw new Error('synthetic_sqlite_read_error');
      return prepare(sql);
    });
    try {
      expect(() => store.getExecution(fixture.interruptedId)).toThrow('synthetic_sqlite_read_error');
      expect(() => store.listExecutions()).toThrow('synthetic_sqlite_read_error');
      expect(store.getExecutionOutput(fixture.completedId)).toEqual(fixture.output);
    } finally { spy.mockRestore(); }
    expect(rawPreviewEvidence(db)).toEqual(evidence);
  });

  it('bounds list requests and returns no invented record for a missing ID', () => {
    for (const limit of [-1, 0, 1.5, 1_001, NaN, Infinity]) expect(() => store.listExecutions(limit)).toThrow('invalid_execution_limit');
    expect(store.getExecution('synthetic-missing')).toBeUndefined();
    expect(() => store.getExecutionOutput('synthetic-missing')).toThrow('execution_not_found');
  });
});

describe.each(['native', 'sqljs'] as const)('current schema without preview extensions (%s)', backend => {
  it('reads and writes current records without adding legacy columns or tables', async () => {
    const db = backend === 'sqljs' ? await createSqlJsDatabase(':memory:') : createNativeDatabase(':memory:');
    if (backend === 'native') applyMigrations(db);
    try {
      const store = new WorkflowStore(db);
      const id = store.createExecution({ ephemeral: true });
      store.finishExecution(id, 'success', undefined, []);
      expect(store.getExecution(id)).toMatchObject({ status: 'success', hasOutput: false, output: undefined, historyDiagnostics: [] });
      expect(store.listExecutions()).toHaveLength(1);
      expect(() => store.getExecutionOutput(id)).toThrow('execution_output_unavailable');
      expect(db.prepare('PRAGMA table_info(executions)').all().some(c => c.name === 'output_json')).toBe(false);
      expect(db.prepare('PRAGMA table_info(execution_log_entries)').all()).toEqual([]);
    } finally { db.close?.(); }
  });
});
