import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import * as XLSX from 'xlsx';
import { describe, expect, it } from 'vitest';
import { createDatabaseAsync } from '../../store/db.js';
import { WorkflowStore } from '../../store/workflow-store.js';
import { ArtifactStore } from '../../store/artifact-store.js';
import { WorkDiscoveryService } from '../../work-discovery/service.js';
import { compileBlueprintToWorkflow } from '../../work-discovery/compile/compile-workflow.js';
import { buildDiscoveryBlueprint } from '../../work-discovery/compile/blueprint.js';
import { WorkflowRuntime } from '../../runtime/engine.js';
import { LocalSheetConnector } from '../../modules/local-sheet/connector.js';
import { TransformConnector } from '../../modules/transform/connector.js';
import { enumerateCandidates, replayCandidates, resolveReplayWinners } from '../../work-discovery/synthesis/index.js';
import { buildTableArtifact } from '../../contracts/artifacts/table-build.js';
import { applyClarificationAnswer } from '../../work-discovery/clarification/answer-apply.js';
import { buildClarificationQuestion } from '../../work-discovery/clarification/question.js';
import type { CandidateProgram } from '../../work-discovery/schema.js';
import { observeWorkbookArtifact } from '../../work-discovery/observation/observe-workbook.js';
import { readWorkbookFromPath } from '../../modules/local-sheet/read.js';

function writeSalesXlsx(path: string, rows: Array<{ amount: number; actual: number; target: number }>): void {
  const sheet = XLSX.utils.json_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, 'Sales');
  XLSX.writeFile(workbook, path);
}

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

describe('work discovery correctness regressions', () => {
  it('rejects ANY-pass candidates across multiple examples', () => {
    const tableJune = buildTableArtifact({
      id: 'tbl_june',
      headers: ['amount', 'product_id'],
      matrix: [[100, 1], [100, 2]],
    });
    const tableJuly = buildTableArtifact({
      id: 'tbl_july',
      headers: ['amount', 'product_id'],
      matrix: [[50, 1], [150, 2]],
    });
    const sourceId = 'input:sales';
    const observations = [
      {
        id: 'obs_june',
        exampleId: 'ex_june',
        path: 'field.총매출',
        label: '총매출',
        value: { kind: 'number' as const, value: 200, display: '200' },
        role: 'dynamic_value' as const,
        required: true,
      },
      {
        id: 'obs_july',
        exampleId: 'ex_july',
        path: 'field.총매출',
        label: '총매출',
        value: { kind: 'number' as const, value: 200, display: '200' },
        role: 'dynamic_value' as const,
        required: true,
      },
    ];
    const sources = [{ id: sourceId, connector: 'input_artifact', label: 'sales', kind: 'workbook' as const, relevance: 1 }];
    const candidates = enumerateCandidates(observations, sources, { [sourceId]: tableJune });
    const replayedRaw = replayCandidates({
      candidates,
      examples: [
        { exampleId: 'ex_june', observations: [observations[0]!] },
        { exampleId: 'ex_july', observations: [observations[1]!] },
      ],
      snapshotsByExample: {
        ex_june: { [sourceId]: tableJune },
        ex_july: { [sourceId]: tableJuly },
      },
    });
    const { candidates: replayed } = resolveReplayWinners(replayedRaw, ['field.총매출']);
    const sumAmount = replayed.find((candidate) =>
      candidate.expr.op === 'aggregate' && candidate.expr.fn === 'sum' && candidate.expr.column === 'amount',
    );
    const sumProduct = replayed.find((candidate) =>
      candidate.expr.op === 'aggregate' && candidate.expr.fn === 'sum' && candidate.expr.column === 'product_id',
    );
    expect(sumAmount?.status).toBe('accepted');
    expect(sumProduct?.status).not.toBe('accepted');
  });

  it('isolates clarification to affected observation paths', () => {
    const candidate = (id: string, path: string, column: string): CandidateProgram => ({
      id,
      observationPath: path,
      expr: { op: 'aggregate', input: { op: 'source', sourceId: 'input:sales' }, fn: 'sum', column },
      score: { total: 0.95, replay: 1, simplicity: 0.7 },
      replayResults: [{ exampleId: 'ex_1', expected: 1, actual: 1, match: 1, pass: true }],
      status: 'accepted',
    });
    const session = {
      id: 'disc_iso',
      status: 'needs_clarification' as const,
      revision: 1,
      userGoal: '보고',
      exampleIds: ['ex_1'],
      sourceInventory: [],
      observations: [
        { id: 'o1', exampleId: 'ex_1', path: 'field.total_sales', label: '총매출', value: { kind: 'number' as const, value: 100, display: '100' }, role: 'dynamic_value' as const, required: true },
        { id: 'o2', exampleId: 'ex_1', path: 'field.order_count', label: '주문 수', value: { kind: 'number' as const, value: 3, display: '3' }, role: 'dynamic_value' as const, required: true },
      ],
      candidates: [
        candidate('c_sales_a', 'field.total_sales', 'amount'),
        candidate('c_sales_b', 'field.total_sales', 'actual'),
        candidate('c_count', 'field.order_count', 'amount'),
      ],
      budgets: { sourceReadsUsed: 1, sourceReadsMax: 10, elapsedMs: 1 },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const question = buildClarificationQuestion({ sessionId: session.id, candidates: session.candidates })!;
    const answered = applyClarificationAnswer(session, question, question.options[0]!.id);
    const orderCountWinner = answered.candidates.find((entry) => entry.observationPath === 'field.order_count' && entry.status === 'accepted');
    expect(orderCountWinner?.id).toBe('c_count');
  });

  it('rejects aggregate replay on truncated snapshots', () => {
    const truncated = buildTableArtifact({
      id: 'tbl_trunc',
      headers: ['amount'],
      matrix: [[100], [100]],
      rowLimit: 2,
      source: { table: 'sales', queryFingerprint: 'limited' },
    });
    truncated.truncated = true;
    const observations = [{
      id: 'obs_1',
      exampleId: 'ex_1',
      path: 'field.총매출',
      label: '총매출',
      value: { kind: 'number' as const, value: 999999, display: '999999' },
      role: 'dynamic_value' as const,
      required: true,
    }];
    const replayed = replayCandidates({
      candidates: enumerateCandidates(observations, [{ id: 'rdb:sales', connector: 'rdb', label: 'sales', kind: 'table', relevance: 1 }], { 'rdb:sales': truncated }),
      examples: [{ exampleId: 'ex_1', observations }],
      snapshotsByExample: { ex_1: { 'rdb:sales': truncated } },
    });
    expect(replayed.every((candidate) => candidate.status !== 'accepted')).toBe(true);
  });

  it('observes XLSX workbook output artifacts', () => {
    const dir = join(tmpdir(), `ax-wd-xlsx-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    const path = join(dir, 'report.xlsx');
    writeSalesXlsx(path, [{ amount: 42, actual: 10, target: 20 }]);
    const { workbook, tables } = readWorkbookFromPath(path);
    const observations = observeWorkbookArtifact('ex_xlsx', workbook, tables);
    expect(observations.length).toBeGreaterThan(0);
  });

  it('fails closed on schema rename without silent wrong column selection', () => {
    const renamed = buildTableArtifact({
      id: 'tbl_renamed',
      headers: ['sales_amount', 'actual', 'target'],
      matrix: [[100, 50, 80]],
    });
    const observations = [{
      id: 'obs_amount',
      exampleId: 'ex_1',
      path: 'field.총매출',
      label: '총매출',
      value: { kind: 'number' as const, value: 100, display: '100' },
      role: 'dynamic_value' as const,
      required: true,
    }];
    const replayed = replayCandidates({
      candidates: enumerateCandidates(observations, [{ id: 'input:sales', connector: 'input_artifact', label: 'sales', kind: 'workbook', relevance: 1 }], { 'input:sales': renamed }),
      examples: [{ exampleId: 'ex_1', observations }],
      snapshotsByExample: { ex_1: { 'input:sales': renamed } },
    });
    const amountWinner = replayed.find((candidate) =>
      candidate.expr.op === 'aggregate' && candidate.expr.fn === 'sum' && candidate.expr.column === 'amount' && candidate.status === 'accepted',
    );
    expect(amountWinner).toBeUndefined();
  });
});
