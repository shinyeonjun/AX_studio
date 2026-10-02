import { afterEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createSqlJsDatabase, openReadonlySqlJs } from '../persistence/db/sqljs.js';
import { openReadonlyNativeSqlite } from '../persistence/db-native.js';
import { RdbConnector } from '../connectors/rdb/connector.js';
import type { AppDatabase } from '../persistence/db.js';
import { WorkflowStore } from '../persistence/workflow-store.js';
import { WorkflowRuntime } from './engine.js';
import { createTestConnectors } from '../testing/connectors/test-connectors.js';
import type { Connector } from '../connectors/types.js';
import type { MessageToolDraft } from '../contracts/tool-result.js';
import type { WorkflowIR } from '../workflow/schema.js';

// Reviewer-owned probes. All files and payloads are synthetic; no provider/network calls.
const handles: AppDatabase[] = [];
const fixturesRoot = resolve('independent-review-fixtures');
mkdirSync(fixturesRoot, { recursive: true });
afterEach(() => {
  for (const db of handles.splice(0)) db.close?.();
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

function persist(db: AppDatabase): void {
  const flush = (db as AppDatabase & { persistNow(): void }).persistNow;
  flush.call(db);
}

async function fixture(fileBacked = false) {
  const path = fileBacked ? resolve(fixturesRoot, randomUUID() + '.db') : ':memory:';
  const db = await createSqlJsDatabase(path);
  handles.push(db);
  const store = new WorkflowStore(db);
  store.setConnection('gmail', true, { label: 'Synthetic fixture only' });
  const session = store.saveWorkspaceChat({ messages: [{ role: 'user', content: 'Synthetic review probe' }] });
  const calls: Record<string, unknown>[] = [];
  const gmail: Connector = {
    name: 'gmail',
    prepareMessageSend: async (draft: MessageToolDraft) => {
      if (draft.tool !== 'gmail') throw new Error('wrong tool');
      return { provider: 'gmail', accountId: 'synthetic-sender@example.test', accountLabel: 'Synthetic sender',
        destinationId: draft.to, destinationLabel: draft.to };
    },
    execute: async (_action, params) => {
      calls.push(structuredClone(params));
      return { ok: true, data: { id: 'synthetic-receipt-' + calls.length } };
    },
  };
  const config = { store, globalActive: true, workflowActive: {}, connectors: { ...createTestConnectors(), gmail } };
  const runtime = new WorkflowRuntime(config);
  const ir: WorkflowIR = { name: 'Independent review fixture', goal: 'One literal synthetic send', version: 1,
    inputs: [], steps: [{ id: 'send', type: 'action', connector: 'gmail', action: 'message.send',
      sideEffect: 'EXTERNAL_HIGH', params: { to: 'synthetic-recipient@example.test', subject: 'Fixture', body: 'Original synthetic body' } }],
    permissions: {}, approval: [], allowExternalAuto: false, assumptions: [], sideEffects: {}, dataPolicy: {} };
  const pending = await runtime.executeWorkflow(ir, { ephemeral: true, workspaceSessionId: session.id });
  expect(pending.status).toBe('pending_approval');
  persist(db);
  const approvalId = pending.pendingApprovalId!;
  return { db, path, store, session, calls, config, runtime, approvalId };
}

async function review(f: Awaited<ReturnType<typeof fixture>>, runtime = f.runtime) {
  const source = runtime.getToolResult(f.approvalId)!;
  return runtime.reviewToolResult({ approvalId: f.approvalId, workspaceSessionId: f.session.id, revision: source.revision });
}

async function restartFromDisk(f: Awaited<ReturnType<typeof fixture>>) {
  // Copy the exact disk image before pending sql.js persistence timers run.
  const snapshot = readFileSync(f.path);
  const crashPath = resolve(fixturesRoot, randomUUID() + '-crash-image.db');
  writeFileSync(crashPath, snapshot);
  const restartedPath = resolve(fixturesRoot, randomUUID() + '-restarted.db');
  writeFileSync(restartedPath, snapshot);
  const db = await createSqlJsDatabase(restartedPath);
  handles.push(db);
  const store = new WorkflowStore(db);
  const runtime = new WorkflowRuntime({ ...f.config, store });
  return { store, runtime };
}

describe('independent ADR 0002 contract probes', () => {
  it('durably consumes a claim before dispatch so crash recovery cannot send again', async () => {
    const f = await fixture(true);
    vi.useFakeTimers();
    const sealed = await review(f);
    const first = await f.runtime.continueAfterApproval(f.approvalId, sealed.confirmation);
    expect(first.toolSendOutcome?.status).toBe('sent');
    const recovered = await restartFromDisk(f);
    const diskStatus = recovered.store.getApproval(f.approvalId)?.status;
    if (diskStatus === 'pending') {
      const fresh = await review(f, recovered.runtime);
      await recovered.runtime.continueAfterApproval(f.approvalId, fresh.confirmation);
    }
    console.log('CRASH_PROBE', JSON.stringify({ diskStatus, providerCalls: f.calls.length }));
    expect(f.calls, 'a restart must not make an already dispatched action resendable').toHaveLength(1);
  });

  it('durably cancels a pending approval before returning cancellation', async () => {
    const f = await fixture(true);
    vi.useFakeTimers();
    expect(f.store.rejectPendingApproval(f.approvalId)).toBe(true);
    f.store.finishExecution(f.store.getApproval(f.approvalId)!.executionId, 'cancelled', 'approval_rejected', []);
    f.runtime.discardToolDraft(f.approvalId);
    const recovered = await restartFromDisk(f);
    const diskStatus = recovered.store.getApproval(f.approvalId)?.status;
    if (diskStatus === 'pending') {
      const fresh = await review(f, recovered.runtime);
      await recovered.runtime.continueAfterApproval(f.approvalId, fresh.confirmation);
    }
    console.log('CANCEL_PROBE', JSON.stringify({ diskStatus, providerCalls: f.calls.length }));
    expect(f.calls, 'a cancelled approval must stay cancelled across restart').toHaveLength(0);
  });

  it('durably records a provider receipt before reporting success', async () => {
    const f = await fixture(true);
    vi.useFakeTimers();
    f.config.connectors.gmail.execute = async (_action, params) => {
      f.calls.push(structuredClone(params));
      // Model a slow provider: the claim/intent reached disk while dispatch was in flight.
      persist(f.db);
      return { ok: true, data: { id: 'synthetic-durable-receipt' } };
    };
    const sealed = await review(f);
    expect((await f.runtime.continueAfterApproval(f.approvalId, sealed.confirmation)).status).toBe('success');
    const recovered = await restartFromDisk(f);
    const outcome = recovered.runtime.getToolSendOutcome(f.approvalId);
    console.log('RECEIPT_PROBE', JSON.stringify({ recoveredOutcome: outcome?.status, providerCalls: f.calls.length }));
    expect(outcome?.status, 'confirmed success must remain confirmed after restart').toBe('sent');
  });

  it('reports refresh failure while retaining successful provider outcome', async () => {
    const f = await fixture();
    const runtime = new WorkflowRuntime({ ...f.config, onExecutionFinished: () => { throw new Error('Synthetic refresh failure'); } });
    const sealed = await review(f, runtime);
    const result = await runtime.continueAfterApproval(f.approvalId, sealed.confirmation);
    expect(result.status).toBe('success');
    expect(result.toolSendOutcome?.status).toBe('sent');
    expect(f.calls).toHaveLength(1);
    expect(result.refreshWarning, 'the host must report success plus refresh failure').toBe(true);
  });

  it('invalidates the edited draft and seal when its workspace session is deleted', async () => {
    const f = await fixture();
    f.runtime.updateToolDraft({ approvalId: f.approvalId, workspaceSessionId: f.session.id, revision: 1,
      draft: { tool: 'gmail', to: 'synthetic-recipient@example.test', subject: '', body: 'Deleted-session private synthetic edit' } });
    const sealed = await review(f);
    f.store.deleteWorkspaceChat(f.session.id);
    expect(f.store.getWorkspaceChat(f.session.id)).toBeFalsy();
    const draftRetained = f.runtime.getToolResult(f.approvalId)?.draft.tool === 'gmail';
    const result = await f.runtime.continueAfterApproval(f.approvalId, sealed.confirmation);
    console.log('DELETED_SESSION_PROBE', JSON.stringify({ draftRetained, result: result.status, providerCalls: f.calls.length }));
    expect(f.calls, 'a seal must not remain valid after its session is deleted').toHaveLength(0);
  });

  it('enforces read-only SQLite execution in the supported sql.js read adapter', async () => {
    const path = resolve(fixturesRoot, randomUUID() + '-readonly.db');
    const writer = await createSqlJsDatabase(path);
    handles.push(writer);
    writer.exec('CREATE TABLE fixture (value INTEGER)');
    writer.prepare('INSERT INTO fixture VALUES (?)').run(1);
    persist(writer);
    vi.stubEnv('AX_DB_BACKEND', 'sqljs');
    const page = await new RdbConnector({ type: 'sqlite', filePath: path, allowedTables: ['fixture'] })
      .execute('query.read', { table: 'fixture' }, { executionId: 'synthetic-read', variables: {}, log: () => undefined });
    expect(page.ok).toBe(true);
    expect(page.data).toMatchObject({ source: { executionId: 'synthetic-read', readOnlyEnforced: true } });
    const sourceBytes = readFileSync(path);
    const reader = await openReadonlySqlJs(path);
    try {
      expect(() => reader.all('UPDATE fixture SET value = 2 RETURNING value'),
        'a runtime read-only adapter must reject write SQL').toThrow();
    } finally {
      console.log('SQLITE_PROBE', JSON.stringify({ declaredReadOnly: true, memoryRows: reader.all('SELECT value FROM fixture'),
        sourceFileUnchanged: sourceBytes.equals(readFileSync(path)) }));
      reader.close();
    }
  });

  it('enforces native SQLite read-only opening as a positive control', async () => {
    const path = resolve(fixturesRoot, randomUUID() + '-native-readonly.db');
    const writer = await createSqlJsDatabase(path);
    handles.push(writer);
    writer.exec('CREATE TABLE fixture (value INTEGER)');
    writer.prepare('INSERT INTO fixture VALUES (?)').run(1);
    persist(writer);
    const reader = openReadonlyNativeSqlite(path);
    try {
      expect(reader.all('SELECT value FROM fixture')).toEqual([{ value: 1 }]);
      expect(() => reader.all('UPDATE fixture SET value = 2 RETURNING value')).toThrow(/readonly|read.only/iu);
    } finally { reader.close(); }
  });
});
