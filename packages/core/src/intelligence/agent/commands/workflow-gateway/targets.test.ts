import { describe, expect, it } from 'vitest';
import type { WorkflowStore } from '../../../../persistence/workflow-store.js';
import type { WorkflowIR } from '../../../../workflow/schema.js';
import { oneShotTargetInputs } from './targets.js';

describe('oneShotTargetInputs', () => {
  it('scopes each dynamic destination choice to its exact action step', async () => {
    const store = {
      getConnections: () => [{
        connector: 'http',
        connected: true,
        config: { endpoints: [
          { id: 'api-a', label: 'API A', baseUrl: 'https://a.example/' },
          { id: 'api-b', label: 'API B', baseUrl: 'https://b.example/' },
        ] },
      }],
    } as unknown as WorkflowStore;
    const workflow = {
      steps: [
        { type: 'action', id: 'read-a', connector: 'http', action: 'request', params: { path: 'items' } },
        { type: 'action', id: 'read-b', connector: 'http', action: 'request', params: { path: 'orders' } },
        { type: 'action', id: 'send', connector: 'slack', action: 'message.send', params: { text: '완료' } },
      ],
    } as unknown as WorkflowIR;

    const inputs = await oneShotTargetInputs(store, workflow, async () => ({
      ok: true,
      data: { channels: [{ id: 'C_OPS', name: '운영' }] },
    }));

    expect(inputs).toMatchObject([
      { id: 'execution-read-a-http-connection', stepId: 'read-a', capabilityId: 'http.request', parameterName: 'connectionId' },
      { id: 'execution-read-b-http-connection', stepId: 'read-b', capabilityId: 'http.request', parameterName: 'connectionId' },
      { id: 'execution-send-slack-channel', stepId: 'send', capabilityId: 'slack.message.send', parameterName: 'channel' },
    ]);
  });
});
