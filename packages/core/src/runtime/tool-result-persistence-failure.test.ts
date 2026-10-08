import { afterEach, describe, expect, it, vi } from 'vitest';
import { copyFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createSqlJsDatabase } from '../persistence/db/sqljs.js';
import type { AppDatabase } from '../persistence/db.js';
import { WorkflowStore } from '../persistence/workflow-store.js';
import { WorkflowRuntime } from './engine.js';
import { createTestConnectors } from '../testing/connectors/test-connectors.js';
import type { Connector } from '../connectors/types.js';
import type { WorkflowIR } from '../workflow/schema.js';

const handles: AppDatabase[] = [];
afterEach(() => { vi.restoreAllMocks(); handles.splice(0).forEach(db => db.close?.()); vi.useRealTimers(); });
async function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'ax-send-durability-'));
  const path = join(root, 'synthetic.sqlite');
  const db = await createSqlJsDatabase(path); handles.push(db);
  const store = new WorkflowStore(db);
  store.setConnection('gmail', true);
  const session = store.saveWorkspaceChat({ messages: [{ role: 'user', content: 'Synthetic durability test only' }] });
  const gmail: Connector = { name: 'gmail', prepareMessageSend: async draft => ({ provider: 'gmail',
    accountId: 'sender@example.test', accountLabel: 'sender@example.test', destinationId: draft.tool === 'gmail' ? draft.to : '', destinationLabel: 'recipient@example.test' }),
    execute: vi.fn(async () => ({ ok: true, data: { id: 'synthetic-receipt' } })) };
  const observer = vi.fn();
  const config = { store, globalActive: true, connectors: { ...createTestConnectors(), gmail }, onExecutionFinished: observer };
  const runtime = new WorkflowRuntime(config);
  const ir: WorkflowIR = { name: 'Synthetic fixture', goal: 'Literal send', version: 1, inputs: [],
    steps: [{ id: 'send', type: 'action', connector: 'gmail', action: 'message.send', sideEffect: 'EXTERNAL_HIGH',
      params: { to: 'recipient@example.test', subject: '', body: 'Original' } }],
    permissions: {}, approval: [], allowExternalAuto: false, assumptions: [], sideEffects: {}, dataPolicy: {} };
  const pending = await runtime.executeWorkflow(ir, { ephemeral: true, workspaceSessionId: session.id });
  const approvalId = pending.pendingApprovalId!;
  runtime.updateToolDraft({ approvalId, workspaceSessionId: session.id, revision: 1,
    draft: { tool: 'gmail', to: 'recipient@example.test', subject: '', body: 'Private synthetic override' } });
  db.persistNow(); vi.useFakeTimers();
  const review = () => runtime.reviewToolResult({ approvalId, workspaceSessionId: session.id, revision: 1 });
  const restart = async () => {
    const recoveryPath = join(root, 'restart.sqlite'); copyFileSync(path, recoveryPath);
    const restartedDb = await createSqlJsDatabase(recoveryPath); handles.push(restartedDb);
    const restartedStore = new WorkflowStore(restartedDb);
    return { store: restartedStore, runtime: new WorkflowRuntime({ ...config, store: restartedStore }) };
  };
  observer.mockClear();
  return { db, store, runtime, gmail, approvalId, review, restart, observer };
}
describe('tool-result persistence failures', () => {
  it('does not dispatch if the claim and intent cannot be saved, preserves edits and consumes the old seal', async () => {
    const f = await fixture(); const sealed = await f.review();
    const flush = vi.spyOn(f.db, 'persistNow').mockImplementation(() => { throw new Error('Synthetic disk full'); });
    const result = await f.runtime.continueAfterApproval(f.approvalId, sealed.confirmation);
    expect(result).toMatchObject({ status: 'failed', errorCode: 'database_persistence_failed', pendingApprovalId: f.approvalId });
    expect(f.gmail.execute).not.toHaveBeenCalled();
    expect(f.store.getApproval(f.approvalId)?.status).toBe('pending');
    expect(f.runtime.getToolResult(f.approvalId)?.draft).toMatchObject({ body: 'Private synthetic override' });
    flush.mockRestore();
    expect((await f.runtime.continueAfterApproval(f.approvalId, sealed.confirmation)).errorCode).toBe('tool_result_stale');
    const fresh = await f.review();
    expect((await f.runtime.continueAfterApproval(f.approvalId, fresh.confirmation)).toolSendOutcome?.status).toBe('sent');
    expect(f.gmail.execute).toHaveBeenCalledTimes(1);
  });
  it('retains a known provider receipt but reports failed local persistence, with no resend after restart', async () => {
    const f = await fixture(); const sealed = await f.review();
    vi.mocked(f.gmail.execute).mockImplementation(async () => {
      vi.spyOn(f.db, 'persistNow').mockImplementation(() => { throw new Error('Synthetic disk full'); });
      return { ok: true, data: { id: 'synthetic-receipt' } };
    });
    const result = await f.runtime.continueAfterApproval(f.approvalId, sealed.confirmation);
    expect(result).toMatchObject({ status: 'failed', errorCode: 'database_persistence_failed', refreshWarning: true,
      toolSendOutcome: { status: 'sent', receiptId: 'synthetic-receipt' } });
    expect(f.observer.mock.calls.map(([completion]) => completion.status)).toEqual(['failed']);
    const recovered = await f.restart();
    expect(recovered.runtime.getToolSendOutcome(f.approvalId)?.status).toBe('unknown');
    expect(recovered.runtime.getToolResult(f.approvalId)).toBeUndefined();
    await recovered.runtime.continueAfterApproval(f.approvalId, sealed.confirmation);
    await f.runtime.continueAfterApproval(f.approvalId, sealed.confirmation);
    expect(f.gmail.execute).toHaveBeenCalledTimes(1);
  });
  it('does not acknowledge cancellation when its record cannot be saved', async () => {
    const f = await fixture();
    vi.spyOn(f.db, 'persistNow').mockImplementation(() => { throw new Error('Synthetic disk full'); });
    expect(() => f.store.rejectPendingApproval(f.approvalId)).toThrow('database_persistence_failed');
    expect(f.store.getApproval(f.approvalId)?.status).toBe('pending');
    expect(f.gmail.execute).not.toHaveBeenCalled();
    expect((await f.restart()).store.getApproval(f.approvalId)?.status).toBe('pending');
  });
});
