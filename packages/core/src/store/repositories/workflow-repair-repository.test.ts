import { describe, expect, it } from 'vitest';
import { createDatabaseAsync } from '../db.js';
import { WorkflowStore } from '../workflow-store.js';

const candidate = {
  id: 'repair_candidate_1',
  op: 'rename_column' as const,
  sourceId: 'sheet:sales',
  stepId: 'read_sales',
  from: 'customer_count',
  to: 'customers',
  expectedType: 'number',
  actualType: 'integer',
  confidence: 0.65,
};

describe('workflow repair proposal persistence', () => {
  it('round-trips a bounded proposal and deduplicates the same drift', async () => {
    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);
    store.saveWorkflow({
      id: 'workflow-repair-store',
      version: 1,
      name: 'repair store fixture',
      goal: 'test proposal persistence',
      steps: [],
      permissions: {},
      approval: [],
      allowExternalAuto: false,
      assumptions: [],
      sideEffects: {},
      dataPolicy: {},
    });

    const first = store.createRepairProposal({
      workflowId: 'workflow-repair-store',
      baseVersion: 1,
      candidates: [candidate],
    });
    const duplicate = store.createRepairProposal({
      workflowId: 'workflow-repair-store',
      baseVersion: 1,
      candidates: [candidate],
    });

    expect(duplicate.id).toBe(first.id);
    expect(store.getRepairProposal(first.id)).toMatchObject({
      id: first.id,
      workflowId: 'workflow-repair-store',
      baseVersion: 1,
      status: 'proposed',
      candidates: [candidate],
      replay: { status: 'not_run', total: 0, passed: 0, failed: 0, cases: [] },
    });
    expect(store.listRepairProposals({ workflowId: 'workflow-repair-store' })).toHaveLength(1);
    db.close?.();
  });

  it('persists rejection and application metadata without storing execution payloads', async () => {
    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);
    store.saveWorkflow({
      id: 'workflow-repair-status',
      version: 1,
      name: 'repair status fixture',
      goal: 'test proposal status',
      steps: [],
      permissions: {},
      approval: [],
      allowExternalAuto: false,
      assumptions: [],
      sideEffects: {},
      dataPolicy: {},
    });
    const proposal = store.createRepairProposal({
      workflowId: 'workflow-repair-status',
      baseVersion: 1,
      candidates: [candidate],
    });

    const rejected = store.updateRepairProposal(proposal.id, {
      status: 'rejected',
      rejectionReason: '사용자가 적용하지 않음',
    });
    expect(rejected).toMatchObject({ status: 'rejected', rejectionReason: '사용자가 적용하지 않음' });

    const applied = store.updateRepairProposal(proposal.id, {
      status: 'applied',
      appliedVersion: 2,
    });
    expect(applied).toMatchObject({ status: 'applied', appliedVersion: 2 });
    expect(JSON.stringify(applied)).not.toContain('execution payload');
    db.close?.();
  });
});
