import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { createDatabaseAsync } from '../../../persistence/db.js';
import { WorkflowStore } from '../../../persistence/workflow-store.js';
import { ArtifactStore } from '../../../persistence/artifact-store.js';
import { WorkDiscoveryService } from '../../../work-discovery/service.js';
import { WorkflowRuntime } from '../../../runtime/engine.js';
import { LocalSheetConnector } from '../../../connectors/local-sheet/connector.js';
import { readWorkbookFromPath } from '../../../connectors/local-sheet/read/workbook.js';
import { TransformConnector } from '../../../connectors/transform/connector.js';
import { writeSalesXlsx } from './fixtures.js';

const cleanup: Array<() => void> = [];
afterEach(() => { for (const dispose of cleanup.splice(0).reverse()) dispose(); });

function writeReportDocument(artifactStore: ArtifactStore, artifactId: string, fields: {
  totalSales: number;
  orderCount: number;
  achievement: number;
}): void {
  artifactStore.putDocumentArtifact(artifactId, {
    id: artifactId,
    text: `총매출: ${fields.totalSales}\n주문수: ${fields.orderCount}\n달성률: ${fields.achievement}%`,
    pages: [{
      index: 0,
      text: `총매출: ${fields.totalSales}\n주문수: ${fields.orderCount}\n달성률: ${fields.achievement}%`,
    }],
    tables: [],
    images: [],
  });
}

async function setupDiscovery(dir: string) {
  const db = await createDatabaseAsync(join(dir, 'workflow.db'));
  let closed = false;
  const close = () => { if (!closed) { db.close?.(); closed = true; } };
  cleanup.push(close);
  const store = new WorkflowStore(db);
  const artifactStore = new ArtifactStore(join(dir, 'artifacts'));
  const snapshotDir = join(dir, 'snapshots');
  mkdirSync(snapshotDir, { recursive: true });
  const service = new WorkDiscoveryService({
    store,
    artifactStore,
    snapshotDir,
    materializeWorkbook: readWorkbookFromPath,
  });
  return { close, store, artifactStore, service, snapshotDir };
}

describe('work discovery north-star e2e', () => {
  it('discovers rules from historical output+input, publishes workflow, and runs on new data', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ax-wd-e2e-'));
    cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
    const historicalSales = join(dir, 'historical_sales.xlsx');
    const currentSales = join(dir, 'current_sales.xlsx');
    writeSalesXlsx(historicalSales, [
      { amount: 100, actual: 50, target: 80 },
      { amount: 100, actual: 50, target: 60 },
      { amount: 100, actual: 50, target: 60 },
    ]);
    writeSalesXlsx(currentSales, [
      { amount: 200, actual: 100, target: 160 },
      { amount: 200, actual: 100, target: 120 },
      { amount: 200, actual: 100, target: 120 },
    ]);

    const { close, store, artifactStore, service } = await setupDiscovery(dir);
    const inputArtifact = artifactStore.importFile(historicalSales);
    const outputArtifactId = 'art_report_pdf';
    writeReportDocument(artifactStore, outputArtifactId, {
      totalSales: 300,
      orderCount: 3,
      achievement: 75,
    });

    const started = service.start({
      goal: '월간 매출 보고 자동화',
      exampleArtifactIds: [outputArtifactId],
      inputArtifactIds: [inputArtifact.id],
    });

    const finalState = await service.waitForTerminal(started.id, 20_000);
    expect(finalState?.status).toBe('ready_to_publish');

    const replayCases = store.listDiscoveryReplayCases(started.id);
    expect(replayCases).toHaveLength(1);
    expect(replayCases[0]?.exampleId).toBe(finalState?.exampleIds[0]);
    expect(JSON.parse(replayCases[0]?.expectedObservationsJson ?? '[]')).not.toHaveLength(0);
    expect(JSON.parse(replayCases[0]?.lastResultJson ?? '[]')).not.toHaveLength(0);

    const published = service.publish(started.id, '월간 매출 보고');
    expect('workflowId' in published).toBe(true);
    if (!('workflowId' in published)) return;

    const workflow = store.getWorkflow(published.workflowId);
    expect(workflow).toBeTruthy();
    const evalSteps = workflow!.steps.filter((step) => step.type === 'action').filter((step) => step.action === 'evaluate');
    expect(evalSteps.length).toBeGreaterThanOrEqual(3);
    for (const step of evalSteps) {
      expect(step.params.expr).toBeTruthy();
    }

    const runtime = new WorkflowRuntime({
      store,
      globalActive: true,
      workflowActive: {},
      connectors: {
        local_sheet: new LocalSheetConnector(),
        transform: new TransformConnector(),
      },
    });
    const execution = await runtime.executeWorkflow(workflow!, {
      ephemeral: true,
      input: { sourcePath: currentSales },
    });
    expect(execution.status).toBe('success');
    const values = Object.fromEntries(execution.output!.fields.map(field => [field.path, JSON.parse(field.valueJson)]));
    expect(values).toEqual({
      'field.총매출.page_1.segment_1.value_1': 600,
      'field.주문수.page_1.segment_1.value_1': 3,
      'field.달성률.page_1.segment_1.value_1': 75,
    });
    expect(store.getExecution(execution.executionId)?.output).toEqual(execution.output);
    expect(JSON.stringify(execution.log)).not.toContain('valueJson');

    // A failed subsequent run must not inherit the previous successful result.
    writeSalesXlsx(currentSales, [{ amount: 100, actual: 20, target: 0 }]);
    const invalid = await runtime.executeWorkflow(workflow!, { ephemeral: true, input: { sourcePath: currentSales } });
    expect(invalid.status).toBe('failed');
    expect(invalid.output).toBeUndefined();
    expect(store.getExecution(invalid.executionId)?.output).toBeUndefined();

    close();
    const reopened = await createDatabaseAsync(join(dir, 'workflow.db'));
    try {
      const recovered = new WorkflowStore(reopened);
      expect(recovered.getExecution(execution.executionId)?.output).toEqual(execution.output);
      expect(recovered.getExecution(invalid.executionId)?.output).toBeUndefined();
    } finally { reopened.close?.(); }

    const document = JSON.parse(workflow!.document ?? '{}') as { fields?: Array<{ outputPath: string }> };
    expect(document.fields?.length).toBeGreaterThanOrEqual(3);
  }, 30_000);
});
