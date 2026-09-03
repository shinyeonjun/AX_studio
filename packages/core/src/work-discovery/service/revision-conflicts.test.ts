import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { createDiscoveryCommandGateway } from '../../agent/commands/discovery-gateway.js';
import { createDatabaseAsync } from '../../store/db.js';
import { WorkflowStore } from '../../store/workflow-store.js';
import { buildDiscoveryBlueprint } from '../compile/blueprint.js';
import { WorkDiscoveryService } from '../service.js';
import { makeSession } from './fixtures.js';

describe('WorkDiscoveryService', () => {
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
});
