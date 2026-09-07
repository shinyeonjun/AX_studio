import { describe, expect, it } from 'vitest';
import { createDatabaseAsync } from '../../../../../persistence/db.js';
import type { AxCommandReadContext, AxCommandReadGateway } from '../../read-gateway.js';
import { WorkflowStore } from '../../../../../persistence/workflow-store.js';
import { AxCommandService } from '../../service.js';
import { AGENT_COMMAND_CONTEXT } from '../../access.js';

describe('AxCommandService read gateway routing', () => {
  it('does not enter the source read gateway for workflow-only commands', async () => {
    const db = await createDatabaseAsync(':memory:');
    let readCalls = 0;
    let contextFactoryCalls = 0;
    const readGateway: AxCommandReadGateway = {
      execute: async () => {
        readCalls += 1;
        return { tool: 'sources.list', ok: true, data: { sources: [] } };
      },
    };
    const service = new AxCommandService(new WorkflowStore(db), { readGateway });
    const readOptions = {
      designToolContextFactory: () => {
        contextFactoryCalls += 1;
        return {
          connections: [],
          connectedConnectorIds: [],
        } satisfies AxCommandReadContext;
      },
    };

    const workflows = await service.execute({ name: 'workflow.list' }, readOptions);
    expect(workflows.status).toBe('ok');
    expect(readCalls).toBe(0);
    expect(contextFactoryCalls).toBe(0);

    const sources = await service.execute({ name: 'source.list' }, readOptions);
    expect(sources.status).toBe('ok');
    expect(readCalls).toBe(1);
    expect(contextFactoryCalls).toBe(1);
  });

  it('routes progressive discovery reads through the same guarded gateway', async () => {
    const db = await createDatabaseAsync(':memory:');
    const calls: Array<{ tool: string; args: Record<string, unknown> }> = [];
    const readGateway: AxCommandReadGateway = {
      execute: async (request) => {
        calls.push(request);
        return { tool: request.tool, ok: true, data: { candidates: [] } };
      },
    };
    const service = new AxCommandService(new WorkflowStore(db), { readGateway });
    const designToolContext = { connections: [], connectedConnectorIds: [] } satisfies AxCommandReadContext;

    const search = await service.execute({
      name: 'discovery.search',
      args: { query: '주문', kind: 'database_table', limit: 5, offset: 20 },
    }, { designToolContext });
    const describe = await service.execute({
      name: 'discovery.describe',
      args: { assetId: 'rdb:public.orders', depth: 'schema', limit: 5, offset: 20 },
    }, { designToolContext });

    expect(search.status).toBe('ok');
    expect(describe.status).toBe('ok');
    expect(calls).toEqual([
      { tool: 'discovery.search', args: { query: '주문', kind: 'database_table', limit: 5, offset: 20 } },
      { tool: 'discovery.describe', args: { assetId: 'rdb:public.orders', depth: 'schema', limit: 5, offset: 20 } },
    ]);
  });

  it('loads persisted discovery metadata in the default read context', async () => {
    const db = await createDatabaseAsync(':memory:');
    try {
      const store = new WorkflowStore(db);
      store.setConnection('rdb', true, {
        type: 'sqlite',
        filePath: 'D:/test/readonly.db',
        allowedTables: ['orders'],
      });
      store.upsertDiscoveryMetadata({
        assetId: 'rdb:orders',
        description: '결제 주문 원장',
        aliases: ['결제'],
        fields: [],
      });
      const service = new AxCommandService(store);
      const result = await service.execute({
        name: 'discovery.search',
        args: { query: '결제', kind: 'database_table' },
      }, { executionContext: AGENT_COMMAND_CONTEXT });

      expect(result.status).toBe('ok');
      expect(result.data).toMatchObject({
        candidates: [{ id: 'rdb:orders', label: 'orders', description: '결제 주문 원장' }],
      });
    } finally {
      db.close?.();
    }
  });
});
