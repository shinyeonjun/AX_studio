import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { createDatabaseAsync } from '../../../../store/db.js';
import { WorkflowStore } from '../../../../store/workflow-store.js';
import { AxCommandService } from '../../service.js';
import { repairCommandCandidate, repairCommandWorkflow } from './fixtures.js';

const commandChatContext = { executionContext: { origin: 'agent' as const } };

describe('AxCommandService repair apply', () => {
  it('inspects and applies a replay-passing repair as a new reversible workflow version', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ax-command-repair-'));
    const sessionRoot = join(root, 'wd_command_repair');
    mkdirSync(sessionRoot, { recursive: true });
    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);
    const workflow = repairCommandWorkflow();
    store.saveWorkflow(workflow);
    const now = new Date().toISOString();
    store.saveDiscoverySession({
      id: 'wd_command_repair',
      status: 'published',
      revision: 1,
      userGoal: 'command repair fixture',
      exampleIds: [],
      sourceInventory: [{ id: 'sheet:sales', connector: 'local_sheet', label: 'Sales', kind: 'table', relevance: 1 }],
      observations: [],
      candidates: [],
      budgets: { sourceReadsUsed: 1, sourceReadsMax: 12, elapsedMs: 1 },
      createdAt: now,
      updatedAt: now,
    });
    const example = store.insertDiscoveryExample({
      sessionId: 'wd_command_repair',
      outputArtifactIds: ['output_command_repair'],
      inputArtifactIds: [],
    });
    const manifestPath = join(sessionRoot, 'history.json');
    writeFileSync(manifestPath, JSON.stringify({
      id: 'history_command_repair',
      kind: 'table',
      columns: [{ name: 'customer_count', type: 'integer', nullable: false, inferred: true }],
      rows: [{ index: 0, values: { customer_count: 42 } }],
    }));
    store.insertDiscoverySnapshot({
      id: 'snapshot_command_repair',
      sessionId: 'wd_command_repair',
      exampleId: example.id,
      sourceId: 'sheet:sales',
      kind: 'table',
      manifestPath,
      fingerprint: 'fingerprint_command_repair',
      capturedAt: now,
    });
    store.upsertDiscoveryReplayCase({
      id: 'replay_command_repair',
      sessionId: 'wd_command_repair',
      exampleId: example.id,
      snapshotSetId: 'snapshot_set_command_repair',
      expectedObservationsJson: JSON.stringify([{
        id: 'observation_command_repair',
        exampleId: example.id,
        path: 'field.customer_count',
        value: { kind: 'number', value: 42 },
        role: 'dynamic_value',
        required: true,
      }]),
      createdAt: now,
    });
    const proposal = store.createRepairProposal({
      workflowId: workflow.id!,
      baseVersion: 1,
      candidates: [repairCommandCandidate],
    });
    const service = new AxCommandService(store, { repairSnapshotRoot: root });

    const inspected = await service.execute({
      name: 'repair.inspect',
      args: { repairId: proposal.id },
    });
    expect(inspected).toMatchObject({
      command: 'repair.inspect',
      status: 'ok',
      data: { proposal: { id: proposal.id }, replay: { status: 'passed', total: 1, passed: 1 } },
    });
    expect(JSON.stringify(inspected)).not.toContain('"value":42');

    const applied = await service.execute({
      name: 'repair.apply',
      args: { repairId: proposal.id, candidateId: repairCommandCandidate.id, baseVersion: 1 },
    }, commandChatContext);
    expect(applied).toMatchObject({
      command: 'repair.apply',
      status: 'ok',
      data: {
        workflowId: workflow.id,
        version: 2,
        rollbackVersion: 1,
        replay: { status: 'passed', total: 1, passed: 1 },
      },
    });
    const oldEvaluation = store.getWorkflow(workflow.id!, 1)?.steps.find((step) => step.id === 'eval_customer_count');
    const newEvaluation = store.getWorkflow(workflow.id!)?.steps.find((step) => step.id === 'eval_customer_count');
    expect(oldEvaluation).toMatchObject({
      type: 'action',
      params: { expr: { column: 'customer_count' } },
    });
    expect(newEvaluation).toMatchObject({
      type: 'action',
      params: { expr: { column: 'customers' } },
    });
    expect(store.getRepairProposal(proposal.id)).toMatchObject({ status: 'applied', appliedVersion: 2 });
    db.close?.();
  });
});
