import { describe, expect, it } from 'vitest';
import { createDatabaseAsync } from '../../../../store/db.js';
import type { AxCommandReadContext, AxCommandReadGateway } from '../../read-gateway.js';
import { WorkflowStore } from '../../../../store/workflow-store.js';
import { AxCommandService } from '../../service.js';

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
});
