import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { createDatabaseAsync } from '../../../store/db.js';
import { WorkflowStore } from '../../../store/workflow-store.js';
import { ArtifactStore } from '../../../store/artifact-store.js';
import { WorkDiscoveryService } from '../../../work-discovery/service.js';
import { WorkflowRuntime } from '../../../runtime/engine.js';
import { LocalSheetConnector } from '../../../modules/local-sheet/connector.js';
import { TransformConnector } from '../../../modules/transform/connector.js';
import { writeSalesXlsx } from './fixtures.js';

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
  const db = await createDatabaseAsync(':memory:');
  const store = new WorkflowStore(db);
  const artifactStore = new ArtifactStore(join(dir, 'artifacts'));
  const snapshotDir = join(dir, 'snapshots');
  mkdirSync(snapshotDir, { recursive: true });
  const service = new WorkDiscoveryService({ store, artifactStore, snapshotDir });
  return { store, artifactStore, service, snapshotDir };
}

describe('work discovery north-star e2e', () => {
  it('discovers rules from historical output+input, publishes workflow, and runs on new data', async () => {
    const dir = join(tmpdir(), `ax-wd-e2e-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
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

    const { store, artifactStore, service } = await setupDiscovery(dir);
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
    const evalSteps = workflow!.steps.filter((step) => step.type === 'action' && step.action === 'evaluate');
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

    const document = JSON.parse(workflow!.document ?? '{}') as { fields?: Array<{ outputPath: string }> };
    expect(document.fields?.length).toBeGreaterThanOrEqual(3);
  }, 30_000);
});
