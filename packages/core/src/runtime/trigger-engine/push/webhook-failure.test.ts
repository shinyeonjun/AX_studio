import { createServer } from 'node:http';
import { describe, expect, it, vi } from 'vitest';
import { createDatabaseAsync } from '../../../store/db.js';
import { WorkflowStore } from '../../../store/workflow-store.js';
import { WorkflowRuntime } from '../../engine.js';
import { createTestConnectors } from '../../../modules/test-connectors.js';
import { TriggerEngine } from '../../trigger-engine.js';
import { findFreePort } from './fixtures.js';

describe('TriggerEngine webhook startup failure', () => {
  it('reports a listener startup failure when the configured port is occupied', async () => {
    const blocker = createServer();
    await new Promise<void>((resolve, reject) => {
      blocker.once('error', reject);
      blocker.listen(0, '127.0.0.1', () => resolve());
    });
    const address = blocker.address();
    const port = typeof address === 'object' && address ? address.port : 0;
    if (!port) throw new Error('failed to allocate a blocker port');

    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);
    const runtime = new WorkflowRuntime({
      store,
      globalActive: true,
      workflowActive: {},
      connectors: createTestConnectors(),
    });
    store.setConnection('webhook', true, {
      port,
      secret: 'hook-secret',
      secretStored: true,
    });
    const engine = new TriggerEngine(store, runtime);

    try {
      engine.start();
      await vi.waitFor(() => expect(engine.pushTransportStatus('webhook.inbound')).toMatchObject({ phase: 'error' }));
      expect(engine.pushTransportActive('webhook.inbound')).toBe(false);
    } finally {
      await engine.stop();
      await new Promise<void>((resolve, reject) => blocker.close((error) => (error ? reject(error) : resolve())));
    }
  });
});
