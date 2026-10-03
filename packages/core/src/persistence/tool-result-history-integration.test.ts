import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createNativeDatabase } from './db-native.js';
import { createSqlJsDatabase, openReadonlySqlJs } from './db/sqljs.js';
import type { AppDatabase } from './db/types.js';
import { WorkflowStore } from './workflow-store.js';
import {
  createPreviewApprovalFixture, openCurrentPreviewHistory, previewApprovalHistoryBytes,
} from './repositories/fixtures/preview-approval-history.fixture.js';

// Composition controls use newly owned synthetic files only. A crash image is
// copied before timers or close can flush the live sql.js image.
let directory: string | undefined;
const handles: AppDatabase[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const db of handles.splice(0)) db.close?.();
  vi.useRealTimers();
  if (directory) {
    const owned = realpathSync(directory);
    expect(dirname(owned)).toBe(realpathSync(tmpdir()));
    expect(basename(owned)).toMatch(/^ax-tool-history-integration-/u);
    rmSync(owned, { recursive: true, force: true });
  }
  directory = undefined;
});
function ownDirectory() {
  directory = mkdtempSync(join(tmpdir(), 'ax-tool-history-integration-'));
  return directory;
}

describe.each(['native', 'sqljs'] as const)('snapshot and durable barrier composition (%s)', backend => {
  it('rejects a persistence barrier inside a read without committing the caller transaction', async () => {
    const path = join(ownDirectory(), 'synthetic.db');
    const db = backend === 'native' ? createNativeDatabase(path) : await createSqlJsDatabase(path);
    handles.push(db);
    db.exec('CREATE TABLE synthetic_values (id INTEGER PRIMARY KEY)');
    db.prepare('INSERT INTO synthetic_values VALUES (1)').run();
    db.persistNow();
    db.exec('BEGIN');
    db.prepare('INSERT INTO synthetic_values VALUES (2)').run();
    db.readSnapshot(() => {
      expect(db.prepare('SELECT id FROM synthetic_values ORDER BY id').all()).toEqual([{ id: 1 }, { id: 2 }]);
      expect(() => db.persistNow()).toThrow(/read_snapshot_write_forbidden|persistence_transaction_open/u);
      expect(() => db.prepare('INSERT INTO synthetic_values VALUES (3)').run()).toThrow('read_snapshot_write_forbidden');
    });
    expect(() => db.persistNow()).toThrow('persistence_transaction_open');
    db.exec('ROLLBACK');
    expect(db.prepare('SELECT id FROM synthetic_values').all()).toEqual([{ id: 1 }]);
    expect(() => db.persistNow()).not.toThrow();
  });
});

describe('read-only image and history-preserving cancellation composition', () => {
  it('retains guarded nested snapshots and the curated query gate in a read-only image', async () => {
    const path = join(ownDirectory(), 'synthetic-readonly.db');
    const writer = await createSqlJsDatabase(path);
    handles.push(writer);
    writer.exec('CREATE TABLE synthetic_values (id INTEGER PRIMARY KEY)');
    writer.prepare('INSERT INTO synthetic_values VALUES (1)').run();
    writer.persistNow();
    const original = readFileSync(path);
    const reader = await openReadonlySqlJs(path);
    try {
      reader.readSnapshot(() => reader.readSnapshot(() => {
        expect(reader.all('SELECT id FROM synthetic_values')).toEqual([{ id: 1 }]);
        expect(() => reader.all('PRAGMA query_only = OFF')).toThrow('sqlite_read_only_query_required');
        expect(() => reader.all('UPDATE synthetic_values SET id = 2 RETURNING id')).toThrow('sqlite_read_only_query_required');
        expect(() => reader.close()).toThrow('read_snapshot_write_forbidden');
      }));
      expect(() => reader.readSnapshot(() => { throw new Error('synthetic read failure'); })).toThrow('synthetic read failure');
      expect(reader.all('SELECT id FROM synthetic_values')).toEqual([{ id: 1 }]);
    } finally { reader.close(); }
    expect(readFileSync(path)).toEqual(original);
  });

  it('durably records cancellation while retaining corrupt preview bytes before acknowledgement', async () => {
    vi.useFakeTimers();
    const path = join(ownDirectory(), 'synthetic-history.db');
    const fixture = createPreviewApprovalFixture(path, 'malformed_tail');
    const db = await openCurrentPreviewHistory(path, 'sqljs');
    handles.push(db);
    const store = new WorkflowStore(db);
    const original = previewApprovalHistoryBytes(db);
    expect(store.rejectPendingApproval(fixture.approvalId)).toBe(true);
    store.finishExecution(fixture.pendingId, 'cancelled', 'approval_rejected', [], { preserveHistory: true });
    expect(previewApprovalHistoryBytes(db)).toEqual(original);
    const crashPath = join(directory!, 'synthetic-crash-image.db');
    writeFileSync(crashPath, readFileSync(path));
    const reopened = await createSqlJsDatabase(crashPath);
    handles.push(reopened);
    expect(previewApprovalHistoryBytes(reopened)).toEqual(original);
    const recovered = new WorkflowStore(reopened);
    expect(recovered.getApproval(fixture.approvalId)?.status).toBe('rejected');
    expect(recovered.getExecution(fixture.pendingId)).toMatchObject({ status: 'cancelled', errorCode: 'approval_rejected' });
  });

  it('propagates a failed cancellation barrier without replacing historical payloads', async () => {
    vi.useFakeTimers();
    const path = join(ownDirectory(), 'synthetic-barrier-failure.db');
    const fixture = createPreviewApprovalFixture(path, 'malformed_checkpoint');
    const db = await openCurrentPreviewHistory(path, 'sqljs');
    handles.push(db);
    const store = new WorkflowStore(db);
    const original = previewApprovalHistoryBytes(db);
    expect(store.rejectPendingApproval(fixture.approvalId)).toBe(true);
    const before = readFileSync(path);
    vi.spyOn(db, 'persistNow').mockImplementationOnce(() => { throw new Error('synthetic persistence failure'); });
    let failure: unknown;
    try { store.finishExecution(fixture.pendingId, 'cancelled', 'approval_rejected', [], { preserveHistory: true }); }
    catch (error) { failure = error; }
    expect(failure).toMatchObject({
      message: 'database_persistence_failed', code: 'database_persistence_failed',
      cause: expect.objectContaining({ message: 'synthetic persistence failure' }),
    });
    expect(readFileSync(path)).toEqual(before);
    expect(previewApprovalHistoryBytes(db)).toEqual(original);
  });
});
