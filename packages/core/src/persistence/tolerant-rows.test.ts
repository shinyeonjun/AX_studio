import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDatabaseAsync, type AppDatabase } from './db.js';
import { WorkflowStore } from './workflow-store.js';

const workflow = (id: string) => ({
  id, name: id, goal: 'tolerant read fixture', version: 1,
  inputs: [], steps: [], permissions: {}, approval: [], allowExternalAuto: false,
  assumptions: [], sideEffects: {}, dataPolicy: {},
});

describe('tolerant list reads', () => {
  let db: AppDatabase;
  let store: WorkflowStore;
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    db = await createDatabaseAsync(':memory:');
    store = new WorkflowStore(db);
    warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => {
    warn.mockRestore();
    db.close?.();
  });

  it('skips a corrupt approval in recovery, pending and snapshot lists but keeps typed single reads', () => {
    const executionId = store.createExecution({ ephemeral: true });
    const healthy = store.createApproval({ executionId, actionIds: ['a'], reason: 'ok' });
    const corrupt = store.createApproval({ executionId, actionIds: ['b'], reason: 'secret reason', payload: { token: 'secret-token' } });
    db.prepare('UPDATE approvals SET action_ids_json = ? WHERE id = ?').run('{broken', corrupt);

    expect(store.getApprovalRecoveryCandidates().map((a) => a.id)).toEqual([healthy]);
    expect(store.getPendingApprovals().map((a) => a.id)).toEqual([healthy]);
    expect(store.getPendingApprovalsWithExecutionSnapshots().map((a) => a.approval.id)).toEqual([healthy]);
    expect(() => store.getApproval(corrupt)).toThrowError(expect.objectContaining({ code: 'invalid_approval_json' }));
    expect(store.listCorruptRows()).toEqual([
      expect.objectContaining({ table: 'approvals', id: corrupt, code: 'invalid_approval_json' }),
    ]);
    // Logged once per row, with identifiers only.
    expect(warn).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(warn.mock.calls)).not.toContain('secret');
  });

  it('keeps scheduling healthy workflows when one stored definition is corrupt', () => {
    store.saveWorkflow(workflow('wf-ok'));
    store.saveWorkflow(workflow('wf-bad'));
    store.setWorkflowActive('wf-ok', true);
    store.setWorkflowActive('wf-bad', true);
    db.prepare("UPDATE workflow_versions SET ir_json = '{not json' WHERE workflow_id = 'wf-bad'").run();

    expect(store.listActiveWorkflowDefinitions().map((entry) => entry.id)).toEqual(['wf-ok']);
    expect(store.listWorkflowDefinitions()).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'wf-ok', workflow: expect.objectContaining({ id: 'wf-ok' }) }),
      expect.objectContaining({ id: 'wf-bad', workflow: null, corrupted: true, latestVersion: 1 }),
    ]));
    expect(store.listCorruptRows()).toEqual([
      expect.objectContaining({ table: 'workflow_versions', id: 'wf-bad@1', code: 'invalid_workflow_json' }),
    ]);
  });

  it('skips a corrupt repair proposal in lists', () => {
    store.saveWorkflow(workflow('wf-repair'));
    const candidate = {
      id: 'c1', op: 'rename_column' as const, sourceId: 'sheet:sales', stepId: 'read', from: 'a', to: 'b',
      expectedType: 'number', actualType: 'integer', confidence: 0.5,
    };
    const first = store.createRepairProposal({ workflowId: 'wf-repair', baseVersion: 1, candidates: [candidate] });
    const second = store.createRepairProposal({ workflowId: 'wf-repair', baseVersion: 1, candidates: [{ ...candidate, id: 'c2', to: 'c' }] });
    db.prepare('UPDATE workflow_repair_proposals SET proposal_json = ? WHERE id = ?').run('{', first.id);

    expect(store.listRepairProposals({ workflowId: 'wf-repair' }).map((p) => p.id)).toEqual([second.id]);
    expect(() => store.getRepairProposal(first.id)).toThrowError(expect.objectContaining({ code: 'invalid_repair_proposal_json' }));
  });

  it('surfaces an unknown workspace source status as a failed source instead of throwing', () => {
    const chat = store.saveWorkspaceChat({ messages: [{ role: 'user', content: 'hi' }] });
    const timestamp = '2026-10-01T00:00:00.000Z';
    store.insertWorkspaceSource({
      id: 'src_drift', sessionId: chat.id, artifactId: 'art', fileName: 'a.pdf', status: 'ready',
      errorMessage: 'stale', createdAt: timestamp, updatedAt: timestamp,
    });
    db.prepare("UPDATE workspace_chat_sources SET status = 'archived' WHERE id = 'src_drift'").run();

    expect(store.listWorkspaceSources(chat.id)).toEqual([
      expect.objectContaining({ id: 'src_drift', status: 'failed', errorCode: 'invalid_workspace_source_status' }),
    ]);
    expect(store.listWorkspaceSources(chat.id)[0]).not.toHaveProperty('errorMessage');
  });
});
