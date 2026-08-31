import { describe, expect, it } from 'vitest';
import { createDatabaseAsync } from '../../store/db.js';
import { WorkflowStore } from '../../store/workflow-store.js';
import type { Connector } from '../../modules/types.js';
import { TransformConnector } from '../../modules/transform/connector.js';
import { WorkflowRuntime } from '../../runtime/engine.js';
import { compileBlueprintToWorkflow } from '../../work-discovery/compile/compile-workflow.js';
import type { DiscoveryBlueprint } from '../../work-discovery/schema.js';

const blueprint: DiscoveryBlueprint = {
  id: 'blueprint_rdb_runtime',
  sessionId: 'session_rdb_runtime',
  name: 'RDB runtime transform',
  goal: '두 RDB 원천을 비교한다',
  sources: [
    { id: 'rdb:sales', connector: 'rdb' },
    { id: 'rdb:targets', connector: 'rdb' },
  ],
  fields: [{
    outputPath: 'field.achievement',
    mapping: {
      op: 'ratio',
      numerator: {
        op: 'aggregate',
        input: { op: 'source', sourceId: 'rdb:sales' },
        fn: 'sum',
        column: 'amount',
      },
      denominator: {
        op: 'aggregate',
        input: { op: 'source', sourceId: 'rdb:targets' },
        fn: 'sum',
        column: 'amount',
      },
      multiplyBy: 100,
    },
    confidence: 1,
    status: 'resolved',
  }],
  replaySummary: { total: 1, passed: 1, failed: 0 },
  publishable: true,
};

describe('compiled Work Discovery runtime', () => {
  it('executes compiled RDB reads and a multi-source transform together', async () => {
    const workflow = compileBlueprintToWorkflow(blueprint);
    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);
    const observed: unknown[] = [];
    const rdb: Connector = {
      name: 'rdb',
      async execute(_action, params) {
        return {
          ok: true,
          data: params.table === 'sales' ? [{ amount: 50 }] : [{ amount: 100 }],
        };
      },
    };
    const transformDelegate = new TransformConnector();
    const transform: Connector = {
      name: 'transform',
      async execute(action, params, ctx) {
        const result = await transformDelegate.execute(action, params, ctx);
        if (result.ok) observed.push(result.data);
        return result;
      },
    };
    const runtime = new WorkflowRuntime({
      store,
      globalActive: true,
      workflowActive: {},
      connectors: { rdb, transform },
    });

    const result = await runtime.executeWorkflow(workflow, { ephemeral: true });

    expect(result.status).toBe('success');
    expect(observed).toContainEqual({
      value: 50,
      outputPath: 'field.achievement',
      kind: 'JsonArtifact',
    });
    db.close?.();
  });
});
