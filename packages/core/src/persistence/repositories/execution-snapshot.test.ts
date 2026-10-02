import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createNativeDatabase } from '../db-native.js';
import type { AppDatabase } from '../db.js';
import { applyMigrations } from '../db/schema.js';
import { WorkflowStore } from '../workflow-store.js';
import { createPreviewFixture, rawPreviewEvidence } from './fixtures/preview-upgrade.fixture.js';
import { appendExecutionLog } from './fixtures/preview-0ba5e22/writer.fixture.js';

describe('native execution projection uses one WAL snapshot', () => {
  let directory: string;
  let reader: AppDatabase;
  let writer: AppDatabase;
  let store: WorkflowStore;
  let fixture: ReturnType<typeof createPreviewFixture>;
  let bodyRows: number[];

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'ax-history-snapshot-'));
    const path = join(directory, 'synthetic.db');
    fixture = createPreviewFixture(path);
    reader = createNativeDatabase(path);
    applyMigrations(reader);
    writer = createNativeDatabase(path);
    store = new WorkflowStore(reader);
    bodyRows = [];
  });
  afterEach(() => {
    vi.restoreAllMocks();
    reader?.close?.();
    writer?.close?.();
    if (directory) rmSync(directory, { recursive: true, force: true });
  });

  // The second real SQLite connection commits synchronously after a specific
  // reader statement, before the reader can issue its next statement. No sleeps.
  function barrier(stage: 'schema' | 'row' | 'size', mutate: () => void) {
    const prepare = reader.prepare.bind(reader);
    let crossed = false;
    vi.spyOn(reader, 'prepare').mockImplementation(sql => {
      const statement = prepare(sql);
      const target = stage === 'schema' ? sql === 'PRAGMA table_info(execution_log_entries)'
        : stage === 'row' ? /FROM executions (?:WHERE|ORDER BY)/.test(sql)
          : sql.includes('COUNT(*) AS count');
      function afterRead<T>(result: T) {
        if (target && !crossed) { crossed = true; mutate(); }
        if (sql.startsWith('SELECT sequence, CAST(entry_json AS BLOB)') && Array.isArray(result)) bodyRows.push(result.length);
        return result;
      }
      return { ...statement,
        get: (...params) => afterRead(statement.get(...params)),
        all: (...params) => afterRead(statement.all(...params)),
      };
    });
    return () => expect(crossed).toBe(true);
  }

  it.each(['row', 'size'] as const)('keeps an append after %s out of the current projection', stage => {
    const added = { ...fixture.tail, message: 'A later synthetic append' };
    const crossed = barrier(stage, () => appendExecutionLog(writer, fixture.interruptedId, added));
    expect(JSON.parse(store.getExecution(fixture.interruptedId)!.logJson)).toEqual([...fixture.checkpoint, fixture.tail, fixture.tail]);
    crossed();
    expect(JSON.parse(store.getExecution(fixture.interruptedId)!.logJson)).toEqual([...fixture.checkpoint, fixture.tail, fixture.tail, added]);
  });

  it.each(['row', 'size'] as const)('keeps status/checkpoint and deleted tail coherent after %s', stage => {
    const replacement = [{ ...fixture.tail, message: 'A new committed checkpoint' }];
    const crossed = barrier(stage, () => {
      writer.prepare('UPDATE executions SET status = ?, log_json = ?, output_json = ? WHERE id = ?')
        .run('success', JSON.stringify(replacement), JSON.stringify(fixture.output), fixture.interruptedId);
      expect(writer.prepare('SELECT COUNT(*) AS count FROM execution_log_entries WHERE execution_id = ?').get(fixture.interruptedId)?.count).toBe(0);
    });
    const old = store.getExecution(fixture.interruptedId)!;
    expect(old).toMatchObject({ status: 'running', hasOutput: false });
    expect(JSON.parse(old.logJson)).toEqual([...fixture.checkpoint, fixture.tail, fixture.tail]);
    crossed();
    const next = store.getExecution(fixture.interruptedId)!;
    expect(next).toMatchObject({ status: 'success', output: fixture.output });
    expect(JSON.parse(next.logJson)).toEqual(replacement);
  });

  it('retains row identity when replacements have equal count and byte length', () => {
    const replacement = { ...fixture.tail, message: 'Synthetic calculation different' };
    expect(Buffer.byteLength(JSON.stringify(replacement))).toBe(Buffer.byteLength(JSON.stringify(fixture.tail)));
    const sizeSql = 'SELECT COUNT(*) AS count, SUM(length(CAST(entry_json AS BLOB))) AS bytes FROM execution_log_entries WHERE execution_id = ?';
    const size = writer.prepare(sizeSql).get(fixture.interruptedId);
    barrier('size', () => {
      writer.prepare('UPDATE execution_log_entries SET entry_json = ? WHERE execution_id = ?')
        .run(JSON.stringify(replacement), fixture.interruptedId);
      expect(writer.prepare(sizeSql).get(fixture.interruptedId)).toEqual(size);
    });
    expect(JSON.parse(store.getExecution(fixture.interruptedId)!.logJson)).toEqual([...fixture.checkpoint, fixture.tail, fixture.tail]);
    expect(JSON.parse(store.getExecution(fixture.interruptedId)!.logJson)).toEqual([...fixture.checkpoint, replacement, replacement]);
  });

  it.each(['row', 'size'] as const)('keeps the 10,000-entry boundary bounded when an append follows %s', stage => {
    writer.prepare('DELETE FROM execution_log_entries WHERE execution_id = ?').run(fixture.interruptedId);
    writer.prepare(`WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 10000)
      INSERT INTO execution_log_entries (execution_id, entry_json) SELECT ?, ? FROM n`)
      .run(fixture.interruptedId, JSON.stringify(fixture.tail));
    barrier(stage, () => appendExecutionLog(writer, fixture.interruptedId, fixture.tail));
    const first = store.getExecution(fixture.interruptedId)!;
    expect(first.historyDiagnostics).toEqual([]);
    expect(JSON.parse(first.logJson)).toHaveLength(10001);
    expect(bodyRows).toEqual([10000]);
    const next = store.getExecution(fixture.interruptedId)!;
    expect(next.historyDiagnostics).toContainEqual({ code: 'execution_log_limit_exceeded', source: 'log_tail' });
    expect(JSON.parse(next.logJson)).toHaveProperty('tailUnavailable', true);
    expect(bodyRows).toEqual([10000]);
  });

  it.each(['row', 'size'] as const)('keeps the 4 MiB input boundary bounded when an append follows %s', stage => {
    writer.prepare('DELETE FROM execution_log_entries WHERE execution_id = ?').run(fixture.interruptedId);
    const entry = { ...fixture.tail, data: { padding: '' } };
    entry.data.padding = 'x'.repeat(4194304 - Buffer.byteLength(JSON.stringify(fixture.checkpoint)) - 1 - Buffer.byteLength(JSON.stringify(entry)));
    appendExecutionLog(writer, fixture.interruptedId, entry);
    barrier(stage, () => appendExecutionLog(writer, fixture.interruptedId, fixture.tail));
    const first = store.getExecution(fixture.interruptedId)!;
    expect(first.historyDiagnostics).toEqual([]);
    expect(first.logJson === JSON.stringify([...fixture.checkpoint, entry]), 'complete original byte-boundary view').toBe(true);
    expect(bodyRows).toEqual([1]);
    const next = store.getExecution(fixture.interruptedId)!;
    expect(next.historyDiagnostics).toContainEqual({ code: 'execution_log_limit_exceeded', source: 'log_tail' });
    expect(bodyRows).toEqual([1]);
  });

  it('covers every row and tail in a list with the same snapshot', () => {
    barrier('row', () => {
      writer.exec('BEGIN');
      writer.prepare('UPDATE executions SET status = ?, log_json = ? WHERE id IN (?, ?)')
        .run('cancelled', '[]', fixture.interruptedId, fixture.pendingId);
      writer.exec('COMMIT');
    });
    const first = store.listExecutions();
    const interrupted = first.find(e => e.id === fixture.interruptedId)!;
    const pending = first.find(e => e.id === fixture.pendingId)!;
    expect(interrupted.status).toBe('running');
    expect(JSON.parse(interrupted.logJson)).toEqual([...fixture.checkpoint, fixture.tail, fixture.tail]);
    expect(pending.status).toBe('pending_approval');
    expect(JSON.parse(pending.logJson)).toEqual([...fixture.checkpoint, fixture.waiting]);
    expect(store.listExecutions().filter(e => [fixture.interruptedId, fixture.pendingId].includes(e.id)))
      .toMatchObject([{ status: 'cancelled', logJson: '[]' }, { status: 'cancelled', logJson: '[]' }]);
  });

  it('includes schema inspection in the snapshot', () => {
    barrier('schema', () => writer.exec('ALTER TABLE execution_log_entries RENAME COLUMN entry_json TO legacy_entry_json'));
    expect(JSON.parse(store.getExecution(fixture.interruptedId)!.logJson)).toEqual([...fixture.checkpoint, fixture.tail, fixture.tail]);
    expect(store.getExecution(fixture.interruptedId)!.historyDiagnostics).toContainEqual({ code: 'unsupported_log_schema', source: 'log_tail' });
  });

  it('keeps lazy output schema and body coherent without fetching logs/tails', () => {
    barrier('schema', () => writer.exec('ALTER TABLE executions RENAME COLUMN output_json TO legacy_output_json'));
    expect(store.getExecutionOutput(fixture.completedId)).toEqual(fixture.output);
    expect(bodyRows).toEqual([]);
    expect(() => store.getExecutionOutput(fixture.completedId)).toThrow('execution_output_unavailable');
  });

  it('does not change raw history or lifecycle state on reads', () => {
    const evidence = rawPreviewEvidence(reader);
    const changes = reader.prepare('SELECT total_changes() AS count').get();
    store.getExecution(fixture.interruptedId);
    store.listExecutions(50, true);
    store.getExecutionOutput(fixture.completedId);
    expect(reader.prepare('SELECT total_changes() AS count').get()).toEqual(changes);
    expect(rawPreviewEvidence(reader)).toEqual(evidence);
  });
});
