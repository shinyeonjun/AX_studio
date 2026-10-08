import { afterEach, describe, expect, it, vi } from 'vitest';
import { copyFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createSqlJsDatabase } from '../persistence/db/sqljs.js';
import { createNativeDatabase } from '../persistence/db-native.js';
import { applyMigrations } from '../persistence/db/schema.js';
import type { AppDatabase } from '../persistence/db.js';
import { WorkflowStore } from '../persistence/workflow-store.js';
import { WorkflowRuntime } from './engine.js';
import { createTestConnectors } from '../testing/connectors/test-connectors.js';
import type { Connector } from '../connectors/types.js';
import type { WorkflowIR } from '../workflow/schema.js';
import type { ToolResultReview } from '../contracts/tool-result.js';

type Kind = 'sqljs' | 'native';
const handles: AppDatabase[] = [];
afterEach(() => { vi.restoreAllMocks(); handles.splice(0).forEach(db => db.close?.()); vi.useRealTimers(); });
async function open(kind: Kind, path: string) {
  const db = kind === 'sqljs' ? await createSqlJsDatabase(path) : createNativeDatabase(path);
  handles.push(db);
  if (kind === 'native') applyMigrations(db);
  return { db, store: new WorkflowStore(db), path };
}
async function fixture(kind: Kind) {
  const root = mkdtempSync(join(tmpdir(), 'ax-approval-ordering-'));
  const state = await open(kind, join(root, 'synthetic.sqlite'));
  state.store.setConnection('gmail', true);
  const session = state.store.saveWorkspaceChat({ messages: [{ role: 'user', content: 'Synthetic crash-boundary fixture' }] });
  const calls: Record<string, unknown>[] = [];
  let outcome: 'sent' | 'unknown' = 'sent';
  const gmail: Connector = { name: 'gmail', prepareMessageSend: async draft => ({ provider: 'gmail',
    accountId: 'sender@example.test', accountLabel: 'sender@example.test',
    destinationId: draft.tool === 'gmail' ? draft.to : '', destinationLabel: 'recipient@example.test' }),
    execute: async (_action, params) => {
      calls.push(structuredClone(params));
      if (outcome === 'unknown') throw new Error('Synthetic provider reply lost');
      return { ok: true, data: { id: 'synthetic-receipt' } };
    } };
  const config = { store: state.store, globalActive: true, connectors: { ...createTestConnectors(), gmail } };
  const runtime = new WorkflowRuntime(config);
  const ir: WorkflowIR = { name: 'Synthetic ordering fixture', goal: 'Literal send', version: 1, inputs: [],
    steps: [{ id: 'send', type: 'action', connector: 'gmail', action: 'message.send', sideEffect: 'EXTERNAL_HIGH',
      params: { to: 'recipient@example.test', subject: '', body: 'Original synthetic body' } }],
    permissions: {}, approval: [], allowExternalAuto: false, assumptions: [], sideEffects: {}, dataPolicy: {} };
  // Flush only the seed. No test-only flush may follow a pending acknowledgement.
  state.db.persistNow();
  vi.useFakeTimers();
  return { ...state, kind, config, runtime, ir, session, calls, setOutcome: (value: typeof outcome) => { outcome = value; } };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
async function pending(f: Fixture) {
  const result = await f.runtime.executeWorkflow(f.ir, { ephemeral: true, workspaceSessionId: f.session.id });
  expect(result.status).toBe('pending_approval');
  return { approvalId: result.pendingApprovalId!, executionId: result.executionId };
}
async function diskSnapshot(kind: Kind, sourcePath: string) {
  // sql.js captures the actual last disk image before mocks/close can flush memory.
  // Native SQLite reopens its committed WAL state; no close/checkpoint is inserted.
  let path = sourcePath;
  if (kind === 'sqljs') {
    path = join(mkdtempSync(join(tmpdir(), 'ax-approval-crash-')), 'snapshot.sqlite');
    copyFileSync(sourcePath, path);
  }
  return open(kind, path);
}
async function restart(f: Fixture) {
  const state = await diskSnapshot(f.kind, f.path);
  return { ...state, runtime: new WorkflowRuntime({ ...f.config, store: state.store }) };
}
async function review(f: Fixture, approvalId: string): Promise<ToolResultReview> {
  const source = f.runtime.getToolResult(approvalId)!;
  return f.runtime.reviewToolResult({ approvalId, workspaceSessionId: f.session.id, revision: source.revision });
}
function failFinish(store: WorkflowStore) {
  vi.spyOn(store, 'finishExecution').mockImplementation(() => {
    throw Object.assign(new Error('Synthetic interruption before execution completion'), { code: 'database_persistence_failed' });
  });
}

describe.each<Kind>(['sqljs', 'native'])('%s approval/execution crash boundaries', kind => {
  it('persists acknowledged pending execution with its original review checkpoint', async () => {
    const f = await fixture(kind);
    const ids = await pending(f);
    const disk = await diskSnapshot(kind, f.path);
    expect(disk.store.getExecution(ids.executionId)?.status).toBe('pending_approval');
    const runtime = new WorkflowRuntime({ ...f.config, store: disk.store });
    expect(runtime.getToolResult(ids.approvalId)?.draft).toEqual({ tool: 'gmail', to: 'recipient@example.test', subject: '', body: 'Original synthetic body' });
    expect((await runtime.continueAfterApproval(ids.approvalId)).errorCode).toBe('tool_result_confirmation_required');
    expect(f.calls).toHaveLength(0);
  });
  it('reconciles a checkpoint persisted before its execution enters pending', async () => {
    const f = await fixture(kind);
    vi.spyOn(f.store, 'markExecutionPending').mockImplementation(() => { throw new Error('Synthetic stop before pending status'); });
    await expect(f.runtime.executeWorkflow(f.ir, { ephemeral: true, workspaceSessionId: f.session.id })).rejects.toThrow('Synthetic stop before pending status');
    const approval = f.store.getPendingApprovals()[0]!;
    const recovered = await restart(f);
    expect(recovered.store.getExecution(approval.executionId)?.status).toBe('pending_approval');
    expect(recovered.runtime.getToolResult(approval.id)?.draft).toEqual({ tool: 'gmail', to: 'recipient@example.test', subject: '', body: 'Original synthetic body' });
    expect(f.calls).toHaveLength(0);
  });
  it('recovers a resolved sent receipt, never replays, then permits terminal deletion', async () => {
    const f = await fixture(kind);
    const ids = await pending(f);
    const sealed = await review(f, ids.approvalId);
    failFinish(f.store);
    const result = await f.runtime.continueAfterApproval(ids.approvalId, sealed.confirmation);
    expect(result.toolSendOutcome).toMatchObject({ status: 'sent', receiptId: 'synthetic-receipt' });
    const recovered = await restart(f);
    expect(recovered.store.getApproval(ids.approvalId)?.status).toBe('approved');
    expect(recovered.store.getExecution(ids.executionId)?.status).toBe('success');
    expect(recovered.runtime.getToolSendOutcome(ids.approvalId)).toEqual(result.toolSendOutcome);
    await recovered.runtime.continueAfterApproval(ids.approvalId, sealed.confirmation);
    expect(f.calls).toHaveLength(1);
    expect(recovered.store.deleteExecution(ids.executionId)).toBe(true);
    expect(recovered.store.getExecution(ids.executionId)).toBeUndefined();
    expect(recovered.store.getApproval(ids.approvalId)).toBeUndefined();
  });
  it('keeps a resolved unknown outcome terminal and does not restore a sendable draft', async () => {
    const f = await fixture(kind);
    const ids = await pending(f);
    const sealed = await review(f, ids.approvalId);
    f.setOutcome('unknown'); failFinish(f.store);
    await f.runtime.continueAfterApproval(ids.approvalId, sealed.confirmation);
    const recovered = await restart(f);
    expect(recovered.store.getApproval(ids.approvalId)?.status).toBe('failed');
    expect(recovered.store.getExecution(ids.executionId)).toMatchObject({ status: 'failed', errorCode: 'tool_send_unknown' });
    expect(recovered.runtime.getToolSendOutcome(ids.approvalId)).toMatchObject({ status: 'unknown', paramsHash: sealed.paramsHash, binding: sealed.binding });
    expect(recovered.runtime.getToolResult(ids.approvalId)).toBeUndefined();
    await recovered.runtime.continueAfterApproval(ids.approvalId, sealed.confirmation);
    expect(f.calls).toHaveLength(1);
  });
  it('recovers durable cancellation before execution completion with zero sends', async () => {
    const f = await fixture(kind);
    const ids = await pending(f);
    expect(f.store.rejectPendingApproval(ids.approvalId)).toBe(true);
    const recovered = await restart(f);
    expect(recovered.store.getExecution(ids.executionId)).toMatchObject({ status: 'cancelled', errorCode: 'approval_rejected' });
    expect(recovered.runtime.getToolResult(ids.approvalId)).toBeUndefined();
    expect(f.calls).toHaveLength(0);
    expect(recovered.store.deleteExecution(ids.executionId)).toBe(true);
  });
  it('repeats metadata recovery safely if recovery stops after resolving the receipt', async () => {
    const f = await fixture(kind);
    const ids = await pending(f);
    const sealed = await review(f, ids.approvalId);
    f.store.claimApproval(ids.approvalId, { binding: sealed.binding, paramsHash: sealed.paramsHash });
    f.store.updateApprovalPayload(ids.approvalId, { toolSendOutcome: { status: 'sent', receiptId: 'synthetic-recovery-receipt', paramsHash: sealed.paramsHash, binding: sealed.binding } });
    const first = await diskSnapshot(kind, f.path);
    failFinish(first.store);
    expect(() => new WorkflowRuntime({ ...f.config, store: first.store })).toThrow('Synthetic interruption before execution completion');
    const next = await diskSnapshot(kind, first.path);
    const recovered = new WorkflowRuntime({ ...f.config, store: next.store });
    expect(next.store.getExecution(ids.executionId)?.status).toBe('success');
    expect(recovered.getToolSendOutcome(ids.approvalId)).toMatchObject({ status: 'sent', receiptId: 'synthetic-recovery-receipt' });
    expect(f.calls).toHaveLength(0);
  });
});
