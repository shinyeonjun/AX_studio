import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { createDiscoveryCommandGateway } from '../../../agent/commands/discovery-gateway.js';
import { createDatabaseAsync } from '../../../store/db.js';
import { WorkflowStore } from '../../../store/workflow-store.js';
import type { DiscoverySourceProvider } from '../../../contracts/discovery-source.js';
import type { DiscoverySessionState } from '../../schema.js';
import { WorkDiscoveryService } from '../../service.js';
import { DiscoverySourceRegistry } from '../../sources/registry.js';
import { makeSession } from '../fixtures.js';

describe('WorkDiscoveryService recovery guards', () => {
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
