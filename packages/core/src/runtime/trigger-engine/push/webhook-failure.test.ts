import { createServer } from 'node:http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setWebhookSecretResolver } from '../../../triggers/webhook/secret-provider.js';
import { createDatabaseAsync } from '../../../persistence/db.js';
import { WorkflowStore } from '../../../persistence/workflow-store.js';
import { WorkflowRuntime } from '../../engine.js';
import { createTestConnectors } from '../../../testing/connectors/test-connectors.js';
import { TriggerEngine } from '../../trigger-engine.js';

const HOOK_SECRET = 'hook-secret-0123456789abcdefghijklmnop';

beforeEach(() => setWebhookSecretResolver((config) => (config as { secret?: string }).secret ?? null));
afterEach(() => setWebhookSecretResolver(null));

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
      connectors: createTestConnectors(),
    });
    store.setConnection('webhook', true, {
      port,
      secret: HOOK_SECRET,
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
