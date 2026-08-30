import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { createDiscoveryCommandGateway } from '../agent/commands/discovery-gateway.js';
import { buildTableArtifact } from '../contracts/artifacts/table-build.js';
import { createDatabaseAsync } from '../store/db.js';
import { WorkflowStore } from '../store/workflow-store.js';
import { buildDiscoveryBlueprint } from './compile/blueprint.js';
import type { CandidateProgram, DiscoverySessionState } from './schema.js';
import { WorkDiscoveryService } from './service.js';
import { DiscoverySourceRegistry } from './sources/registry.js';
import type { DiscoverySourceProvider } from '../contracts/discovery-source.js';

function makeSession(
  id: string,
  overrides: Partial<DiscoverySessionState> = {},
): DiscoverySessionState {
  const now = new Date().toISOString();
  const candidate: CandidateProgram = {
    id: 'candidate_total',
    observationPath: 'field.total',
    expr: { op: 'aggregate', input: { op: 'source', sourceId: 'input:sales' }, fn: 'sum', column: 'amount' },
    score: { total: 1, replay: 1, simplicity: 1 },
    replayResults: [{ exampleId: 'ex_1', expected: 100, actual: 100, match: 1, pass: true }],
    status: 'accepted',
  };
  return {
    id,
    status: 'needs_clarification',
    revision: 3,
    userGoal: '매출 보고 자동화',
    exampleIds: ['ex_1'],
    sourceInventory: [{
      id: 'input:sales',
      connector: 'input_artifact',
      label: 'sales',
      kind: 'workbook',
      relevance: 1,
      metadata: { storedPath: 'sales.xlsx' },
    }],
    observations: [{
      id: 'observation_total',
      exampleId: 'ex_1',
      path: 'field.total',
      label: '총매출',
      value: { kind: 'number', value: 100, display: '100' },
      role: 'dynamic_value',
      required: true,
    }],
    candidates: [candidate],
    pendingQuestion: {
      id: 'question_1',
      sessionId: id,
      kind: 'choose_rule',
      prompt: '어느 규칙이 맞나요?',
      options: [
        { id: 'option_a', label: 'A', candidateIds: ['candidate_total'] },
        { id: 'option_b', label: 'B', candidateIds: ['candidate_other'] },
      ],
      affectedObservationPaths: ['field.total'],
      createdAt: now,
    },
    budgets: { sourceReadsUsed: 0, sourceReadsMax: 12, elapsedMs: 0 },
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe('WorkDiscoveryService', () => {
  it('cancel marks session as cancelled', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ax-discovery-cancel-'));
    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);
    const service = new WorkDiscoveryService({ store, snapshotDir: join(dir, 'snapshots') });
    const now = new Date().toISOString();
    store.saveDiscoverySession({
      id: 'wd_cancel',
      status: 'observing_output',
      revision: 1,
      userGoal: 'cancel test',
      exampleIds: [],
      sourceInventory: [],
      observations: [],
      candidates: [],
      budgets: {
        sourceReadsUsed: 0,
        sourceReadsMax: 12,
        elapsedMs: 0,
      },
      createdAt: now,
      updatedAt: now,
    });

    const cancelled = service.cancel('wd_cancel');
    expect(cancelled?.status).toBe('cancelled');
    db.close?.();
  });

  it('persists the desired recurrence in the session state', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ax-discovery-recurrence-'));
    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);
    const service = new WorkDiscoveryService({ store, snapshotDir: join(dir, 'snapshots') });

    const started = service.start({
      goal: '매일 매출 보고 자동화',
      exampleArtifactIds: ['output_report'],
      desiredRecurrence: '0 9 * * 1-5',
    });

    expect(store.getDiscoverySessionState(started.id)?.desiredRecurrence).toBe('0 9 * * 1-5');
    service.cancel(started.id);
    await new Promise<void>((resolve) => setImmediate(resolve));
    db.close?.();
  });

  it('rejects a stale answer without changing the session', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ax-discovery-answer-conflict-'));
    return createDatabaseAsync(':memory:').then((db) => {
      const store = new WorkflowStore(db);
      const service = new WorkDiscoveryService({ store, snapshotDir: join(dir, 'snapshots') });
      const state = makeSession('wd_answer_conflict');
      store.saveDiscoverySession(state);

      const result = service.answer(state.id, 'question_1', 'option_a', 2);

      expect(result).toMatchObject({ error: 'discovery_revision_conflict', currentRevision: 3 });
      expect(store.getDiscoverySessionState(state.id)).toEqual(state);
      db.close?.();
    });
  });

  it('rejects a stale publish without creating a workflow', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ax-discovery-publish-conflict-'));
    return createDatabaseAsync(':memory:').then((db) => {
      const store = new WorkflowStore(db);
      const service = new WorkDiscoveryService({ store, snapshotDir: join(dir, 'snapshots') });
      const base = makeSession('wd_publish_conflict', {
        status: 'ready_to_publish',
        pendingQuestion: undefined,
      });
      const state = { ...base, blueprint: buildDiscoveryBlueprint(base) };
      store.saveDiscoverySession(state);

      const result = service.publish(state.id, '매출 보고', 2);

      expect(result).toMatchObject({ error: 'discovery_revision_conflict', currentRevision: 3 });
      expect(store.listWorkflows()).toHaveLength(0);
      expect(store.getDiscoverySessionState(state.id)).toEqual(state);
      db.close?.();
    });
  });

  it('returns the original workflow when publish is repeated for a session', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ax-discovery-publish-idempotent-'));
    return createDatabaseAsync(':memory:').then((db) => {
      const store = new WorkflowStore(db);
      const service = new WorkDiscoveryService({ store, snapshotDir: join(dir, 'snapshots') });
      const base = makeSession('wd_publish_idempotent', {
        status: 'ready_to_publish',
        pendingQuestion: undefined,
      });
      store.saveDiscoverySession({ ...base, blueprint: buildDiscoveryBlueprint(base) });

      const first = service.publish(base.id, '매출 보고');
      const second = service.publish(base.id, '다른 이름');

      expect('workflowId' in first).toBe(true);
      expect(second).toEqual(first);
      expect(store.listWorkflows()).toHaveLength(1);
      db.close?.();
    });
  });

  it('maps a stale gateway mutation to the conflict command status', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ax-discovery-gateway-conflict-'));
    return createDatabaseAsync(':memory:').then((db) => {
      const store = new WorkflowStore(db);
      const state = makeSession('wd_gateway_conflict');
      store.saveDiscoverySession(state);
      const gateway = createDiscoveryCommandGateway(store, { snapshotDir: join(dir, 'snapshots') });

      const [status, data, issues] = gateway.answer({
        name: 'discovery.answer',
        args: {
          sessionId: state.id,
          questionId: 'question_1',
          optionId: 'option_a',
          expectedRevision: 2,
        },
      });

      expect(status).toBe('conflict');
      expect(data).toEqual({ currentRevision: 3 });
      expect(issues?.[0]?.code).toBe('discovery_revision_conflict');
      db.close?.();
    });
  });

  it.each(['synthesizing', 'validating'] as const)('resumes a %s checkpoint from persisted snapshots without rereading live sources', async (checkpointStatus) => {
    const dir = mkdtempSync(join(tmpdir(), 'ax-discovery-recovery-'));
    const snapshotDir = join(dir, 'snapshots');
    mkdirSync(snapshotDir, { recursive: true });
    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);
    const now = new Date().toISOString();
    const example = store.insertDiscoveryExample({
      sessionId: 'wd_recovery',
      outputArtifactIds: ['output_already_observed'],
      inputArtifactIds: [],
    });
    const table = buildTableArtifact({
      id: 'table_recovery',
      headers: ['amount'],
      matrix: [[100]],
    });
    const manifestPath = join(snapshotDir, `${table.id}.json`);
    writeFileSync(manifestPath, JSON.stringify(table));
    const source = {
      id: 'test:sales',
      connector: 'test',
      label: 'Sales',
      kind: 'table' as const,
      relevance: 1,
    };
    const observations = [{
      id: 'observation_recovery_total',
      exampleId: example.id,
      path: 'field.total',
      label: '총매출',
      value: { kind: 'number' as const, value: 100, display: '100' },
      role: 'dynamic_value' as const,
      required: true,
    }];
    store.saveDiscoverySession({
      id: 'wd_recovery',
      status: checkpointStatus,
      revision: 4,
      userGoal: '저장된 자료로 매출 보고 자동화',
      exampleIds: [example.id],
      sourceInventory: [source],
      observations,
      candidates: [],
      budgets: { sourceReadsUsed: 1, sourceReadsMax: 12, elapsedMs: 10 },
      createdAt: now,
      updatedAt: now,
    });
    store.insertDiscoverySnapshot({
      id: 'snap_recovery',
      sessionId: 'wd_recovery',
      exampleId: example.id,
      sourceId: source.id,
      kind: 'table',
      artifactId: table.id,
      manifestPath,
      fingerprint: 'fingerprint_recovery',
      metadataJson: JSON.stringify({ connector: source.connector }),
      capturedAt: now,
    });
    const provider: DiscoverySourceProvider = {
      connector: 'test',
      async listSources() {
        throw new Error('live source must not be read during checkpoint recovery');
      },
      async profileSource() {
        throw new Error('live source must not be read during checkpoint recovery');
      },
    };

    new WorkDiscoveryService({
      store,
      snapshotDir,
      sourceRegistry: new DiscoverySourceRegistry([provider]),
      autoResume: true,
    });

    let recovered: DiscoverySessionState | undefined;
    for (let attempt = 0; attempt < 250; attempt += 1) {
      await new Promise<void>((resolve) => setTimeout(resolve, 20));
      recovered = store.getDiscoverySessionState('wd_recovery');
      if (recovered?.status !== checkpointStatus) break;
    }

    expect(recovered?.status).toBe('needs_clarification');
    expect(store.listDiscoveryReplayCases('wd_recovery')).toHaveLength(1);
    expect(recovered?.observations).toEqual(observations);
    db.close?.();
  }, 10_000);

  it('moves a failed automatic recovery to needs_attention and retries from the saved checkpoint', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ax-discovery-retry-'));
    const snapshotDir = join(dir, 'snapshots');
    mkdirSync(snapshotDir, { recursive: true });
    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);
    const now = new Date().toISOString();
    const example = store.insertDiscoveryExample({
      sessionId: 'wd_retry',
      outputArtifactIds: ['output_already_observed'],
      inputArtifactIds: [],
    });
    const source = {
      id: 'test:sales',
      connector: 'test',
      label: 'Sales',
      kind: 'table' as const,
      relevance: 1,
    };
    const observations = [{
      id: 'observation_retry_total',
      exampleId: example.id,
      path: 'field.total',
      label: '총매출',
      value: { kind: 'number' as const, value: 100, display: '100' },
      role: 'dynamic_value' as const,
      required: true,
    }];
    const table = buildTableArtifact({ id: 'table_retry', headers: ['amount'], matrix: [[100]] });
    const manifestPath = join(snapshotDir, `${table.id}.json`);
    store.saveDiscoverySession({
      id: 'wd_retry',
      status: 'synthesizing',
      revision: 4,
      userGoal: '복구 재시도 테스트',
      exampleIds: [example.id],
      sourceInventory: [source],
      observations,
      candidates: [],
      budgets: { sourceReadsUsed: 1, sourceReadsMax: 12, elapsedMs: 10 },
      createdAt: now,
      updatedAt: now,
    });
    store.insertDiscoverySnapshot({
      id: 'snap_retry',
      sessionId: 'wd_retry',
      exampleId: example.id,
      sourceId: source.id,
      kind: 'table',
      artifactId: table.id,
      manifestPath,
      fingerprint: 'fingerprint_retry',
      capturedAt: now,
    });

    const service = new WorkDiscoveryService({
      store,
      snapshotDir,
      sourceRegistry: new DiscoverySourceRegistry([]),
      autoResume: true,
    });

    let needsAttention: DiscoverySessionState | undefined;
    for (let attempt = 0; attempt < 250; attempt += 1) {
      await new Promise<void>((resolve) => setTimeout(resolve, 20));
      needsAttention = store.getDiscoverySessionState('wd_retry');
      if (needsAttention?.status === 'needs_attention') break;
    }

    expect(needsAttention?.status).toBe('needs_attention');
    expect(needsAttention?.recoveryCheckpoint).toBe('synthesizing');
    expect(needsAttention?.errorCode).toBe('discovery_recovery_failed');
    expect(service.inspect('wd_retry')).toMatchObject({
      status: 'needs_attention',
      recoveryCheckpoint: 'synthesizing',
      autoRecoveryAttempts: 1,
    });

    writeFileSync(manifestPath, JSON.stringify(table));
    const retried = service.retry('wd_retry', needsAttention!.revision);
    expect(retried).toMatchObject({ status: 'synthesizing' });

    let recovered: DiscoverySessionState | undefined;
    for (let attempt = 0; attempt < 250; attempt += 1) {
      await new Promise<void>((resolve) => setTimeout(resolve, 20));
      recovered = store.getDiscoverySessionState('wd_retry');
      if (recovered?.status === 'needs_clarification') break;
    }
    expect(recovered?.status).toBe('needs_clarification');
    expect(store.listDiscoveryReplayCases('wd_retry')).toHaveLength(1);
    db.close?.();
  }, 15_000);

  it('does not automatically retry a session whose recovery attempt is already recorded', async () => {
    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);
    const state = makeSession('wd_recovery_exhausted', {
      status: 'synthesizing',
      pendingQuestion: undefined,
      autoRecoveryAttempts: 1,
      recoveryCheckpoint: 'synthesizing',
    });
    store.saveDiscoverySession(state);
    let liveReads = 0;
    const provider: DiscoverySourceProvider = {
      connector: 'test',
      async listSources() {
        liveReads += 1;
        return [];
      },
      async profileSource() {
        liveReads += 1;
        return null;
      },
    };

    new WorkDiscoveryService({
      store,
      sourceRegistry: new DiscoverySourceRegistry([provider]),
      autoResume: true,
    });
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(store.getDiscoverySessionState(state.id)).toMatchObject({
      status: 'needs_attention',
      autoRecoveryAttempts: 1,
      recoveryCheckpoint: 'synthesizing',
      errorCode: 'discovery_recovery_exhausted',
    });
    expect(liveReads).toBe(0);
    db.close?.();
  });

  it('never auto-resumes published or cancelled sessions', async () => {
    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);
    const published = makeSession('wd_already_published', {
      status: 'published',
      pendingQuestion: undefined,
      publishedWorkflowId: 'workflow_existing',
    });
    const cancelled = makeSession('wd_already_cancelled', {
      status: 'cancelled',
      pendingQuestion: undefined,
    });
    store.saveDiscoverySession(published);
    store.saveDiscoverySession(cancelled);

    new WorkDiscoveryService({ store, autoResume: true });
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(store.getDiscoverySessionState(published.id)).toEqual(published);
    expect(store.getDiscoverySessionState(cancelled.id)).toEqual(cancelled);
    db.close?.();
  });

  it('maps a stale manual retry to a conflict without changing the session', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ax-discovery-retry-conflict-'));
    return createDatabaseAsync(':memory:').then((db) => {
      const store = new WorkflowStore(db);
      const state = makeSession('wd_retry_conflict', {
        status: 'needs_attention',
        pendingQuestion: undefined,
        autoRecoveryAttempts: 1,
        recoveryCheckpoint: 'synthesizing',
      });
      store.saveDiscoverySession(state);
      const gateway = createDiscoveryCommandGateway(store, { snapshotDir: join(dir, 'snapshots') });

      const [status, data, issues] = gateway.retry({
        name: 'discovery.retry',
        args: {
          sessionId: state.id,
          expectedRevision: state.revision - 1,
        },
      });

      expect(status).toBe('conflict');
      expect(data).toEqual({ currentRevision: state.revision });
      expect(issues?.[0]?.code).toBe('discovery_revision_conflict');
      expect(store.getDiscoverySessionState(state.id)).toEqual(state);
      db.close?.();
    });
  });
});
