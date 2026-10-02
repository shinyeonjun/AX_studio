// Synthetic crash-boundary regressions for the accepted preview-history policy.
// Real editable runtime approvals; no provider or model is invoked.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { copyFileSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import type { AppDatabase } from '../persistence/db.js';
import { WorkflowStore } from '../persistence/workflow-store.js';
import { createPreviewApprovalFixture, openCurrentPreviewHistory, previewApprovalHistoryBytes } from '../persistence/repositories/fixtures/preview-approval-history.fixture.js';
import { appendExecutionLog } from '../persistence/repositories/fixtures/preview-0ba5e22/writer.fixture.js';
import { WorkflowRuntime } from './engine.js';
import { requiresToolResultReview } from './tool-result-approval.js';
import type { Connector } from '../connectors/types.js';
import type { WorkflowIR } from '../workflow/schema.js';

type Kind = 'native' | 'sqljs';
type Condition = 'malformed_checkpoint' | 'malformed_tail';
const handles: AppDatabase[] = [];
const runtimes: WorkflowRuntime[] = [];
const roots: string[] = [];
const sha = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
function writeObservation(name: string, value: unknown) {
  const directory = process.env.AX_TOOL_RESULT_HISTORY_EVIDENCE_DIR;
  if (directory) writeFileSync(join(directory, name), JSON.stringify(value, null, 2));
}
afterEach(async () => {
  for (const runtime of runtimes.splice(0)) { runtime.stopAccepting(); await runtime.waitForIdle(); }
  vi.restoreAllMocks();
  handles.splice(0).forEach(db => db.close?.());
  vi.useRealTimers();
  for (const root of roots.splice(0)) {
    const owned = realpathSync(root);
    expect(dirname(owned)).toBe(realpathSync(tmpdir()));
    expect(basename(owned)).toMatch(/^ax-history-cancel-restart-/u);
    rmSync(owned, { recursive: true, force: true });
  }
});
async function open(path: string, kind: Kind) {
  const db = await openCurrentPreviewHistory(path, kind);
  handles.push(db);
  return { db, store: new WorkflowStore(db), path };
}
async function seed(kind: Kind, condition: Condition) {
  vi.useFakeTimers();
  const root = mkdtempSync(join(tmpdir(), 'ax-history-cancel-restart-'));
  roots.push(root);
  const path = join(root, 'synthetic-preview.sqlite');
  const preview = createPreviewApprovalFixture(path, 'valid');
  const state = await open(path, kind);
  state.store.setConnection('gmail', true);
  const session = state.store.saveWorkspaceChat({ messages: [{ role: 'user', content: 'Synthetic cancellation/history composition fixture' }] });
  const send = vi.fn(async () => ({ ok: true, data: { id: 'synthetic-unused-receipt' } }));
  const identify = vi.fn(async (draft: { tool: string; to?: string }) => ({ provider: 'gmail',
    accountId: 'sender@example.test', accountLabel: 'sender@example.test',
    destinationId: draft.to ?? '', destinationLabel: 'recipient@example.test' }));
  const gmail: Connector = { name: 'gmail', execute: send, prepareMessageSend: identify };
  const runtime = new WorkflowRuntime({ store: state.store, globalActive: true, workflowActive: {}, connectors: { gmail } });
  runtimes.push(runtime);
  const ir: WorkflowIR = { name: 'Synthetic cancellation fixture', goal: 'Synthetic only', version: 1, inputs: [],
    steps: [{ id: 'send', type: 'action', connector: 'gmail', action: 'message.send', sideEffect: 'EXTERNAL_HIGH',
      params: { to: 'recipient@example.test', subject: '', body: 'Original synthetic cancellation body' } }],
    permissions: {}, approval: [], allowExternalAuto: false, assumptions: [], sideEffects: {}, dataPolicy: {} };
  state.db.persistNow();
  const pending = await runtime.executeWorkflow(ir, { ephemeral: true, workspaceSessionId: session.id });
  expect(pending.status).toBe('pending_approval');
  const approvalId = pending.pendingApprovalId!;
  const executionId = pending.executionId;
  expect(state.store.getApproval(approvalId)?.actionIds).toEqual(['send']);
  expect(requiresToolResultReview(state.store, approvalId)).toBe(true);
  expect(runtime.getToolResult(approvalId)?.draft).toMatchObject({ tool: 'gmail', body: 'Original synthetic cancellation body' });
  // Corrupt only this new, genuine final-one-shot approval's synthetic preview history.
  if (condition === 'malformed_checkpoint') state.db.prepare('UPDATE executions SET log_json = ? WHERE id = ?').run('{broken-synthetic-checkpoint', executionId);
  appendExecutionLog(state.db, executionId, preview.waiting);
  if (condition === 'malformed_tail') state.db.prepare('UPDATE execution_log_entries SET entry_json = ? WHERE execution_id = ?').run('[null]', executionId);
  state.db.prepare('UPDATE executions SET output_json = ? WHERE id = ?').run(JSON.stringify(preview.output), executionId);
  state.db.persistNow();
  const history = previewApprovalHistoryBytes(state.db);
  const diagnostics = state.store.getExecution(executionId)?.historyDiagnostics;
  expect(diagnostics?.some(item => item.source !== 'output')).toBe(true);
  return { ...state, root, runtime, approvalId, executionId, history, diagnostics, send, identify };
}
function summaries(history: ReturnType<typeof previewApprovalHistoryBytes>, executionId: string) {
  const row = history.executions.find(row => row.id === executionId)!;
  const tail = history.tail.filter(row => row.execution_id === executionId);
  return { checkpointHexSha256: sha(String(row.checkpoint)), outputHexSha256: sha(String(row.output)),
    irHexSha256: sha(String(row.snapshot)), tailRows: tail.length, tailHexSha256: sha(JSON.stringify(tail)) };
}
async function recovered(f: Awaited<ReturnType<typeof seed>>, kind: Kind, path: string) {
  const state = await open(path, kind);
  const classified = requiresToolResultReview(state.store, f.approvalId);
  const candidate = state.store.getApprovalRecoveryCandidates().find(item => item.id === f.approvalId);
  const before = previewApprovalHistoryBytes(state.db);
  const beforeStatus = state.store.getExecution(f.executionId)?.status;
  const runtime = new WorkflowRuntime({ store: state.store, globalActive: false, workflowActive: {},
    connectors: { gmail: { name: 'gmail', execute: f.send, prepareMessageSend: f.identify } } });
  runtimes.push(runtime);
  const after = previewApprovalHistoryBytes(state.db);
  expect(state.store.getApproval(f.approvalId)?.status).toBe('rejected');
  expect(state.store.getExecution(f.executionId)).toMatchObject({ status: 'cancelled', errorCode: 'approval_rejected' });
  expect(runtime.getToolResult(f.approvalId)).toBeUndefined();
  let retry: unknown;
  try { retry = await runtime.continueAfterApproval(f.approvalId); }
  catch (error) { retry = String(error); }
  expect(f.send).toHaveBeenCalledTimes(0);
  expect(f.identify).toHaveBeenCalledTimes(0);
  return { ...state, runtime, before, after, beforeStatus, classified, candidate, retry,
    status: state.store.getExecution(f.executionId)?.status, errorCode: state.store.getExecution(f.executionId)?.errorCode,
    diagnosticsAfter: state.store.getExecution(f.executionId)?.historyDiagnostics };
}

describe.each<Kind>(['sqljs', 'native'])('%s actual editable cancellation preserves preview evidence across recovery', kind => {
  it.each<Condition>(['malformed_checkpoint', 'malformed_tail'])('retains original HEX after an interrupted durable rejection: %s', async condition => {
    const f = await seed(kind, condition);
    expect(f.store.rejectPendingApproval(f.approvalId)).toBe(true);
    let barrierFailure: unknown;
    if (kind === 'sqljs') {
      const cause = new Error('Synthetic second cancellation barrier failure');
      const diskBefore = readFileSync(f.path);
      vi.spyOn(f.db, 'persistNow').mockImplementationOnce(() => { throw cause; });
      try { f.store.finishExecution(f.executionId, 'cancelled', 'approval_rejected', [], { preserveHistory: true }); }
      catch (error) { barrierFailure = { message: (error as Error).message, code: (error as { code: string }).code, cause: (error as Error & { cause: Error }).cause.message }; }
      expect(barrierFailure).toEqual({ message: 'database_persistence_failed', code: 'database_persistence_failed', cause: cause.message });
      expect(readFileSync(f.path)).toEqual(diskBefore);
      expect(previewApprovalHistoryBytes(f.db)).toEqual(f.history);
    }
    // Native uses committed WAL state at the interruption after reject, before finish.
    // sql.js copies the actual disk image before close/timers can flush memory.
    const crashPath = kind === 'sqljs' ? join(f.root, 'synthetic-crash-image.sqlite') : f.path;
    if (kind === 'sqljs') copyFileSync(f.path, crashPath);
    const first = await recovered(f, kind, crashPath);
    expect(first.classified).toBe(true);
    expect(first.candidate?.status).toBe('rejected');
    expect(first.beforeStatus).toBe('pending_approval');
    expect(first.before).toEqual(f.history);
    const repeatPath = kind === 'sqljs' ? join(f.root, 'synthetic-second-reopen.sqlite') : first.path;
    if (kind === 'sqljs') copyFileSync(first.path, repeatPath);
    const second = await recovered(f, kind, repeatPath);
    expect(second.candidate).toBeUndefined();
    expect(second.before).toEqual(first.after);
    expect(second.after).toEqual(first.after);
    const result = {
      reproducedBaseCommit: 'ac8c88231c48f1127916e160dfe9c891d0ad2f4c', kind, condition,
      interruption: kind === 'sqljs' ? 'failed_second_barrier_before_acknowledgement' : 'process_cut_after_durable_rejection_before_finish',
      barrierFailure, classified: first.classified, candidateStatus: first.candidate?.status, statusBeforeRecovery: first.beforeStatus,
      statusAfterRecovery: first.status, errorCodeAfterRecovery: first.errorCode,
      initialDiagnostics: f.diagnostics, recoveredDiagnostics: first.diagnosticsAfter,
      original: summaries(f.history, f.executionId), afterRecovery: summaries(first.after, f.executionId), afterSecondReopen: summaries(second.after, f.executionId),
      preservedBeforeConstructor: JSON.stringify(first.before) === JSON.stringify(f.history),
      preservedAfterConstructor: JSON.stringify(first.after) === JSON.stringify(f.history),
      changedPersistedThroughSecondReopen: JSON.stringify(second.after) === JSON.stringify(first.after),
      providerSends: f.send.mock.calls.length, identityLookups: f.identify.mock.calls.length,
      rawSyntheticHistory: { original: f.history, afterRecovery: first.after, afterSecondReopen: second.after },
    };
    writeObservation(`restart-${kind}-${condition}-observations.json`, result);
    expect(first.after, 'Accepted ADR0002 requires rejection recovery to retain checkpoint/output/IR/tail HEX').toEqual(f.history);
    expect(second.before, 'The recovery barrier must commit original bytes before the second reopen').toEqual(f.history);
    expect(second.after, 'A second runtime must retain original bytes and remain terminal').toEqual(f.history);
  });
  it('retains corrupt tail after a fully persisted cancellation and two runtime reopens', async () => {
    const f = await seed(kind, 'malformed_tail');
    expect(f.store.rejectPendingApproval(f.approvalId)).toBe(true);
    f.store.finishExecution(f.executionId, 'cancelled', 'approval_rejected', [], { preserveHistory: true });
    const path = kind === 'sqljs' ? join(f.root, 'synthetic-completed-cancellation.sqlite') : f.path;
    if (kind === 'sqljs') copyFileSync(f.path, path);
    const first = await recovered(f, kind, path);
    expect(first.beforeStatus).toBe('cancelled');
    expect(first.candidate).toBeUndefined();
    expect(first.after).toEqual(f.history);
    const path2 = kind === 'sqljs' ? join(f.root, 'synthetic-completed-cancellation-reopen.sqlite') : path;
    if (kind === 'sqljs') copyFileSync(path, path2);
    const second = await recovered(f, kind, path2);
    expect(second.after).toEqual(f.history);
    writeObservation(`restart-${kind}-completed-cancellation-control.json`, {
      reproducedBaseCommit: 'ac8c88231c48f1127916e160dfe9c891d0ad2f4c', kind, original: summaries(f.history, f.executionId),
      afterSecondReopen: summaries(second.after, f.executionId), originalHistoryPreserved: true,
      status: second.status, errorCode: second.errorCode, providerSends: f.send.mock.calls.length, identityLookups: f.identify.mock.calls.length,
    });
  });
});
