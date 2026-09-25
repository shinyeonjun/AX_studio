import { describe, expect, it } from 'vitest';
import { createDatabaseAsync } from '../../../../../persistence/db.js';
import { createDesignToolReadGateway, type AxCommandReadGateway } from '../../read-gateway.js';
import { WorkflowStore } from '../../../../../persistence/workflow-store.js';
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
      readAuthorization: { capabilityId: 'http.request', params: { method: 'GET', path: 'secure/profile' } },
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
      readAuthorization: { capabilityId: 'http.request', params: { method: 'GET', path: 'secure/profile' } },
    });

    expect(response.issues[0]?.details).toEqual({
      status: 401,
      statusText: 'u'.repeat(120),
      body: 'x'.repeat(4_000),
      truncated: true,
    });
    expect(JSON.stringify(response)).not.toContain('should-not-cross-the-boundary');
  });

  it('keeps host policy failures non-recoverable and exposes only the safe category', async () => {
    const db = await createDatabaseAsync(':memory:');
    const readGateway: AxCommandReadGateway = {
      execute: async () => ({
        tool: 'capabilities.invoke',
        ok: false,
        error: 'ssrf_blocked',
        failureKind: 'host_policy',
      }),
    };
    const service = new AxCommandService(new WorkflowStore(db), { readGateway });

    const response = await service.execute({
      name: 'capability.invoke',
      args: { id: 'http.request', params: { method: 'GET', path: 'secure/profile' } },
    }, {
      ...commandChatContext,
      designToolContext: { connections: [], connectedConnectorIds: [], allowUntrustedData: true },
      readAuthorization: { capabilityId: 'http.request', params: { method: 'GET', path: 'secure/profile' } },
    });

    expect(response).toMatchObject({
      status: 'forbidden',
      issues: [{ failureKind: 'host_policy' }],
    });
    db.close();
  });

  it('carries connector policy classification through the production read gateway', async () => {
    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);
    const service = new AxCommandService(store, { readGateway: createDesignToolReadGateway(store) });

    const response = await service.execute({
      name: 'capability.invoke',
      args: { id: 'http.request', params: { method: 'GET', path: 'secure/profile' } },
    }, {
      ...commandChatContext,
      designToolContext: {
        connections: [],
        connectedConnectorIds: ['http'],
        allowUntrustedData: true,
        connectors: {
          http: {
            name: 'http',
            execute: async () => ({ ok: false, error: 'blocked', errorCode: 'ssrf_blocked' }),
          },
        },
      },
      readAuthorization: {
        capabilityId: 'http.request',
        params: { method: 'GET', path: 'secure/profile' },
      },
    });

    expect(response).toMatchObject({
      status: 'forbidden',
      issues: [{ failureKind: 'host_policy' }],
    });
    expect(JSON.stringify(response)).not.toContain('ssrf_blocked');
    db.close();
  });
});
