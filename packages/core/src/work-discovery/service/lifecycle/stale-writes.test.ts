import { describe, expect, it } from 'vitest';
import { createDatabaseAsync } from '../../../persistence/db.js';
import { WorkflowStore } from '../../../persistence/workflow-store.js';
import { makeSession } from '../fixtures.js';
import { createDiscoveryLifecycleStateOperations } from './state.js';

async function setup() {
  const db = await createDatabaseAsync(':memory:');
  const store = new WorkflowStore(db);
  const ops = createDiscoveryLifecycleStateOperations(
    { store, snapshotDir: 'unused' } as unknown as Parameters<typeof createDiscoveryLifecycleStateOperations>[0],
    new Set(),
  );
  return { db, store, ops };
}

describe('discovery lifecycle strict revision writes', () => {
  it('a stale pipeline transition cannot overwrite a user cancel', async () => {
    const { db, store, ops } = await setup();
    const running = makeSession('wd_stale_transition', { status: 'exploring_sources', pendingQuestion: undefined });
    store.saveDiscoverySession(running);
    const cancelled = { ...running, status: 'cancelled' as const, revision: running.revision + 1 };
    store.saveDiscoverySession(cancelled, running.revision);

    expect(() => ops.transition(running, 'synthesizing')).toThrow(expect.objectContaining({ code: 'discovery_revision_conflict' }));
    expect(store.getDiscoverySessionState(running.id)?.status).toBe('cancelled');
    db.close?.();
  });

  it('patchState refuses to change a cancelled session', async () => {
    const { db, store, ops } = await setup();
    const cancelled = makeSession('wd_patch_cancelled', { status: 'cancelled', pendingQuestion: undefined });
    store.saveDiscoverySession(cancelled);

    expect(() => ops.patchState(cancelled.id, { status: 'needs_clarification' }))
      .toThrow(expect.objectContaining({ code: 'discovery_revision_conflict' }));
    expect(store.getDiscoverySessionState(cancelled.id)).toEqual(cancelled);
    db.close?.();
  });
});
