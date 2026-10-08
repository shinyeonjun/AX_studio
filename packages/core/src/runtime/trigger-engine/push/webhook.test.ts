import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setWebhookSecretResolver } from '../../../triggers/webhook/secret-provider.js';
import { createDatabaseAsync } from '../../../persistence/db.js';
import { WorkflowStore } from '../../../persistence/workflow-store.js';
import { WorkflowRuntime } from '../../engine.js';
import { createTestConnectors, mockSlack } from '../../../testing/connectors/test-connectors.js';
import { TriggerEngine } from '../../trigger-engine.js';
import type { WorkflowIR } from '../../../workflow/schema.js';
import { findFreePort, waitForWebhookListener } from './fixtures.js';

const HOOK_SECRET = 'hook-secret-0123456789abcdefghijklmnop';

beforeEach(() => setWebhookSecretResolver((config) => (config as { secret?: string }).secret ?? null));
afterEach(() => setWebhookSecretResolver(null));

describe('TriggerEngine webhook push lifecycle', () => {
  it('runs enabled webhook workflows and ignores disabled ones', async () => {
    const port = await findFreePort();
    const webhookWorkflow: WorkflowIR = {
      name: 'Webhook 업무',
      goal: 'Webhook 수신 시 Slack 알림',
      version: 1,
      trigger: { type: 'webhook.inbound', path: 'invoice-paid' },
      inputs: ['path', 'body'],
      steps: [
        {
          type: 'action',
          id: 'notify',
          connector: 'slack',
          action: 'message.send',
          params: { channel: '#webhooks', text: 'webhook received' },
          sideEffect: 'EXTERNAL',
        },
      ],
      permissions: {},
      approval: [],
      allowExternalAuto: true,
      assumptions: [],
      sideEffects: {},
      dataPolicy: {},
    };

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

    const { workflowId } = store.saveWorkflow(webhookWorkflow);
    store.setWorkflowActive(workflowId, true);
    const engine = new TriggerEngine(store, runtime);
    try {
      engine.start();
      await waitForWebhookListener(engine);

      const unauthorized = await fetch(`http://127.0.0.1:${port}/hooks/invoice-paid`, {
        method: 'POST',
        headers: { 'x-ax-webhook-secret': 'wrong-secret' },
        body: '{"id":0}',
      });
      expect(unauthorized.status).toBe(401);

      const wrongMethod = await fetch(`http://127.0.0.1:${port}/hooks/invoice-paid`);
      expect(wrongMethod.status).toBe(405);

      const unmatchedPath = await fetch(`http://127.0.0.1:${port}/hooks/unknown`, {
        method: 'POST',
        headers: { 'x-ax-webhook-secret': HOOK_SECRET },
        body: '{"id":0}',
      });
      expect(unmatchedPath.status).toBe(202);
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(store.listExecutions(10)).toHaveLength(0);

      const accepted = await fetch(`http://127.0.0.1:${port}/hooks/invoice-paid`, {
        method: 'POST',
        headers: {
          'x-ax-webhook-secret': HOOK_SECRET,
          'idempotency-key': 'invoice-paid-1',
        },
        body: '{"id":1}',
      });
      expect(accepted.status).toBe(202);
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(mockSlack(runtime.connectors).messages).toHaveLength(1);
      expect(store.listExecutions(10)).toEqual([
        expect.objectContaining({ workflowId, status: 'success', triggerType: 'webhook.inbound' }),
      ]);

      const repeated = await fetch(`http://127.0.0.1:${port}/hooks/invoice-paid`, {
        method: 'POST',
        headers: {
          'x-ax-webhook-secret': HOOK_SECRET,
          'idempotency-key': 'invoice-paid-1',
        },
        body: '{"id":1}',
      });
      expect(repeated.status).toBe(202);
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(mockSlack(runtime.connectors).messages).toHaveLength(1);
      expect(store.listExecutions(10)).toHaveLength(1);

      store.setWorkflowActive(workflowId, false);
      const ignored = await fetch(`http://127.0.0.1:${port}/hooks/invoice-paid`, {
        method: 'POST',
        headers: { 'x-ax-webhook-secret': HOOK_SECRET },
        body: '{"id":2}',
      });
      expect(ignored.status).toBe(202);
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(mockSlack(runtime.connectors).messages).toHaveLength(1);

      await engine.stop();
      await expect(fetch(`http://127.0.0.1:${port}/hooks/invoice-paid`)).rejects.toThrow();

      store.setWorkflowActive(workflowId, true);
      engine.start();
      await waitForWebhookListener(engine);
      const restarted = await fetch(`http://127.0.0.1:${port}/hooks/invoice-paid`, {
        method: 'POST',
        headers: {
          'x-ax-webhook-secret': HOOK_SECRET,
          'idempotency-key': 'invoice-paid-2',
        },
        body: '{"id":2}',
      });
      expect(restarted.status).toBe(202);
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(mockSlack(runtime.connectors).messages).toHaveLength(2);
      expect(store.listExecutions(10)).toHaveLength(2);
    } finally {
      await engine.stop();
    }
  });

  it('runs a webhook workflow saved after the listener already started, with no transport refresh', async () => {
    const port = await findFreePort();
    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);
    const runtime = new WorkflowRuntime({ store, globalActive: true, connectors: createTestConnectors() });
    store.setConnection('webhook', true, { port, secret: HOOK_SECRET, secretStored: true });
    const engine = new TriggerEngine(store, runtime);
    try {
      // Started with no webhook workflow at all, as when the app opens before the job is made.
      engine.start();
      await waitForWebhookListener(engine);

      const { workflowId } = store.saveWorkflow({
        name: '나중에 만든 Webhook 업무', goal: 'Webhook 수신 시 Slack 알림', version: 1,
        trigger: { type: 'webhook.inbound', path: 'order-created' }, inputs: ['path', 'body'],
        steps: [{ type: 'action', id: 'notify', connector: 'slack', action: 'message.send', params: { channel: '#webhooks', text: 'order' }, sideEffect: 'EXTERNAL' }],
        permissions: {}, approval: [], allowExternalAuto: true, assumptions: [], sideEffects: {}, dataPolicy: {},
      });
      store.setWorkflowActive(workflowId, true);

      const accepted = await fetch(`http://127.0.0.1:${port}/hooks/order-created`, {
        method: 'POST',
        headers: { 'x-ax-webhook-secret': HOOK_SECRET, 'idempotency-key': 'order-1' },
        body: '{"id":1}',
      });
      expect(accepted.status).toBe(202);
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(store.listExecutions(10)).toEqual([
        expect.objectContaining({ workflowId, status: 'success', triggerType: 'webhook.inbound' }),
      ]);
    } finally {
      await engine.stop();
    }
  });
});
