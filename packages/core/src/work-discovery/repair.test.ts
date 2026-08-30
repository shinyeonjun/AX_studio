import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createDatabaseAsync } from '../store/db.js';
import { WorkflowStore } from '../store/workflow-store.js';
import type { WorkflowIR } from '../workflow/schema.js';
import type { RepairCandidateOperation } from '../workflow/repair.js';
import { replayRepairCandidate } from './repair.js';

const candidate: RepairCandidateOperation = {
  id: 'repair_candidate_history',
  op: 'rename_column',
  sourceId: 'sheet:sales',
  stepId: 'read_sales',
  from: 'customer_count',
  to: 'customers',
  expectedType: 'number',
  actualType: 'integer',
  confidence: 0.65,
};

function workflowFixture(): WorkflowIR {
  return {
    id: 'discovery_wd_repair',
    version: 1,
    name: 'historical repair fixture',
    goal: '과거 예시로 repair를 검증한다',
    trigger: { type: 'manual' },
    inputs: ['sourcePath'],
    steps: [{
      type: 'action',
      id: 'eval_customer_count',
      connector: 'transform',
      action: 'evaluate',
      params: {
        expr: {
          op: 'aggregate',
          input: { op: 'source', sourceId: 'sheet:sales' },
          fn: 'sum',
          column: 'customer_count',
        },
        outputPath: 'field.customer_count',
      },
      sideEffect: 'NONE',
    }],
    permissions: {},
    approval: [],
    allowExternalAuto: false,
    assumptions: [],
    sideEffects: {},
    dataPolicy: {},
    outputContract: {
      version: 1,
      fields: [{
        path: 'field.customer_count',
        kind: 'number',
        required: true,
        baseline: { sampleCount: 3, numericMin: 10, numericMax: 30, numericToleranceRatio: 0.2 },
      }],
      inputSchemas: [{
        sourceId: 'sheet:sales',
        stepId: 'read_sales',
        columns: [{ name: 'customer_count', type: 'number' }],
      }],
    },
  };
}

async function seedHistory(snapshotRoot: string, includeMissing = false) {
  const db = await createDatabaseAsync(':memory:');
  const store = new WorkflowStore(db);
  const now = new Date().toISOString();
  store.saveDiscoverySession({
    id: 'wd_repair',
    status: 'published',
    revision: 1,
    userGoal: 'repair fixture',
    exampleIds: [],
    sourceInventory: [{ id: 'sheet:sales', connector: 'local_sheet', label: 'Sales', kind: 'table', relevance: 1 }],
    observations: [],
    candidates: [],
    budgets: { sourceReadsUsed: 3, sourceReadsMax: 12, elapsedMs: 1 },
    createdAt: now,
    updatedAt: now,
  });
  const sessionRoot = join(snapshotRoot, 'wd_repair');
  mkdirSync(sessionRoot, { recursive: true });

  for (const [index, value] of [10, 20, 30].entries()) {
    const example = store.insertDiscoveryExample({
      sessionId: 'wd_repair',
      outputArtifactIds: [`output_${index}`],
      inputArtifactIds: [],
    });
    const table = {
      id: `history_${index}`,
      kind: 'table' as const,
      columns: [{ name: 'customer_count', type: 'integer' as const, nullable: false, inferred: true }],
      rows: [{ index: 0, values: { customer_count: value } }],
    };
    const manifestPath = includeMissing && index === 1
      ? join(sessionRoot, 'missing.json')
      : join(sessionRoot, `${table.id}.json`);
    if (!includeMissing || index !== 1) writeFileSync(manifestPath, JSON.stringify(table));
    store.insertDiscoverySnapshot({
      id: `snapshot_${index}`,
      sessionId: 'wd_repair',
      exampleId: example.id,
      sourceId: 'sheet:sales',
      kind: 'table',
      manifestPath,
      fingerprint: `fingerprint_${index}`,
      capturedAt: now,
    });
    store.upsertDiscoveryReplayCase({
      id: `replay_wd_repair_${index}`,
      sessionId: 'wd_repair',
      exampleId: example.id,
      snapshotSetId: `snapshot_set_${index}`,
      expectedObservationsJson: JSON.stringify([{
        id: `observation_${index}`,
        exampleId: example.id,
        path: 'field.customer_count',
        value: { kind: 'number', value },
        role: 'dynamic_value',
        required: true,
      }]),
      createdAt: now,
    });
  }
  return { db, store };
}

describe('historical repair replay', () => {
  it('passes every persisted historical example after a virtual source-column rename', async () => {
    const root = mkdtempSync(join(process.env.TEMP ?? process.cwd(), 'ax-repair-replay-'));
    const { db, store } = await seedHistory(root);

    const replay = replayRepairCandidate(store, workflowFixture(), candidate, { snapshotRoot: root });

    expect(replay).toMatchObject({ status: 'passed', total: 3, passed: 3, failed: 0 });
    expect(replay.cases).toHaveLength(3);
    expect(replay.cases.every((entry) => entry.pass)).toBe(true);
    expect(JSON.stringify(replay)).not.toContain('customer_count":10');
    db.close?.();
  });

  it('blocks apply evidence when one historical snapshot cannot be read', async () => {
    const root = mkdtempSync(join(process.env.TEMP ?? process.cwd(), 'ax-repair-replay-missing-'));
    const { db, store } = await seedHistory(root, true);

    const replay = replayRepairCandidate(store, workflowFixture(), candidate, { snapshotRoot: root });

    expect(replay).toMatchObject({ status: 'unavailable', total: 0, passed: 0, failed: 0 });
    expect(replay.reason).toBe('historical_snapshot_unavailable');
    db.close?.();
  });
});
