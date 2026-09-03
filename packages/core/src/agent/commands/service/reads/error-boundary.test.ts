import { describe, expect, it } from 'vitest';
import { createDatabaseAsync } from '../../../../store/db.js';
import type { AxCommandReadGateway } from '../../read-gateway.js';
import { WorkflowStore } from '../../../../store/workflow-store.js';
import { AxCommandService } from '../../service.js';
import { commandChatContext } from '../fixtures.js';

describe('AxCommandService read error boundary', () => {
  it('preserves bounded read failure details in command issues', async () => {
    const db = await createDatabaseAsync(':memory:');
    const readGateway: AxCommandReadGateway = {
      execute: async () => ({
        tool: 'capabilities.invoke',
        ok: false,
        error: 'http_401',
        errorDetails: {
          status: 401,
          statusText: 'Unauthorized',
          body: '{"error":"unauthorized","hint":"configure the documented lab credential"}',
          truncated: false,
        },
      }),
    };
    const service = new AxCommandService(new WorkflowStore(db), { readGateway });

    const response = await service.execute({
      name: 'capability.invoke',
      args: { id: 'http.request', params: { method: 'GET', path: 'secure/profile' } },
    }, {
      ...commandChatContext,
      designToolContext: { connections: [], connectedConnectorIds: [], allowUntrustedData: true },
    });

    expect(response).toMatchObject({
      command: 'capability.invoke',
      status: 'error',
      issues: [{
        code: 'http_401',
        details: {
          status: 401,
          statusText: 'Unauthorized',
          body: '{"error":"unauthorized","hint":"configure the documented lab credential"}',
          truncated: false,
        },
      }],
    });
  });

  it('strips response headers and caps provider details at the command boundary', async () => {
    const db = await createDatabaseAsync(':memory:');
    const readGateway: AxCommandReadGateway = {
      execute: async () => ({
        tool: 'capabilities.invoke',
        ok: false,
        error: 'http_401',
        errorDetails: {
          status: 401,
          statusText: 'u'.repeat(121),
          body: 'x'.repeat(4_001),
          truncated: false,
          headers: { authorization: 'Bearer should-not-cross-the-boundary' },
        },
      }),
    };
    const service = new AxCommandService(new WorkflowStore(db), { readGateway });

    const response = await service.execute({
      name: 'capability.invoke',
      args: { id: 'http.request', params: { method: 'GET', path: 'secure/profile' } },
    }, {
      ...commandChatContext,
      designToolContext: { connections: [], connectedConnectorIds: [], allowUntrustedData: true },
    });

    expect(response.issues[0]?.details).toEqual({
      status: 401,
      statusText: 'u'.repeat(120),
      body: 'x'.repeat(4_000),
      truncated: true,
    });
    expect(JSON.stringify(response)).not.toContain('should-not-cross-the-boundary');
  });
});
