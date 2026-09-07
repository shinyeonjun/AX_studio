import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { expect, it, vi } from 'vitest';
import { buildDiscoveryBlueprint } from './blueprint.js';
import { compileBlueprintToWorkflow } from './compile-workflow.js';
import { session } from './fixtures.js';
import { instantiateRegisteredConnector } from '../../connectors/module-registry.js';
import { createTestConnectors } from '../../testing/connectors/test-connectors.js';
import { createDatabaseAsync } from '../../persistence/db.js';
import { WorkflowStore } from '../../persistence/workflow-store.js';
import { WorkflowRuntime } from '../../runtime/engine.js';

it.each(['single', 'legacy', 'override', 'multiple'] as const)('runs a saved file workflow with %s source binding', async mode => {
  const root = mkdtempSync(join(tmpdir(), 'ax-scheduled-source-'));
  const db = await createDatabaseAsync(':memory:');
  try {
    const first = join(root, 'first.csv');
    const second = join(root, 'second.csv');
    writeFileSync(first, 'amount\n10\n20\n');
    writeFileSync(second, 'amount\n100\n');
    const base = buildDiscoveryBlueprint(session)!;
    const sources = (mode === 'multiple' ? [first, second] : [first]).map((storedPath, index) => ({
      id: `input:source${index}`, connector: 'input_artifact', metadata: { storedPath },
    }));
    const ir = compileBlueprintToWorkflow({
      ...base, sources, outputContract: undefined,
      fields: sources.map((source, index) => ({
        ...base.fields[0]!, outputPath: `total${index}`,
        mapping: { op: 'aggregate', fn: 'count', input: { op: 'source', sourceId: source.id } },
      })),
      triggerProposal: { type: 'schedule', schedule: '0 * * * *', timezone: 'UTC' },
    }, { defaultSourcePath: first });
    if (mode === 'legacy') {
      const document = JSON.parse(ir.document!);
      delete document.sourceInputs;
      ir.document = JSON.stringify(document);
    }
    const store = new WorkflowStore(db);
    const saved = store.saveWorkflow(ir);
    const connectors = createTestConnectors();
    const localSheet = instantiateRegisteredConnector('local_sheet')!;
    const reads = vi.spyOn(localSheet, 'execute');
    const runtime = new WorkflowRuntime({ store, globalActive: true, workflowActive: {},
      connectors: { ...connectors, local_sheet: localSheet } });
    const result = await runtime.executeWorkflow(store.getWorkflow(saved.workflowId)!, {
      triggerType: 'schedule', ...(mode === 'override' ? { input: { sourcePath: second } } : {}),
    });
    expect(result.status, JSON.stringify(result.log)).toBe('success');
    expect(reads.mock.calls.map(call => call[1].path)).toEqual(
      mode === 'multiple' ? [first, second] : [mode === 'override' ? second : first],
    );
    expect((await reads.mock.results[0]!.value).ok).toBe(true);
  } finally {
    db.close?.();
    rmSync(root, { recursive: true, force: true });
  }
});
