import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { TableArtifact } from '../../contracts/artifacts/table.js';
import { localSheetModulePackage } from '../../connectors/packages/local-sheet.js';
import { validateOutputContract } from '../../runtime/output-contract/output/validate.js';
import { TransformExprSchema } from '../../workflow/transform-expr/dsl.js';
import { evaluateTransformExpr } from '../../workflow/transform-expr/evaluator.js';
import { buildConfirmationQuestion } from '../clarification/question.js';
import { buildDiscoveryBlueprint, canPublish } from '../compile/blueprint.js';
import { compileBlueprintToWorkflow } from '../compile/compile-workflow.js';
import { observeWorkbookArtifact } from '../observation/observe-workbook.js';
import type { OutputObservation } from '../observation/schema.js';
import { DiscoverySessionStateSchema, type SourceDescriptor } from '../schema.js';
import { displayValue, formatMappingLabel, observationDisplay } from '../view.js';
import { compareObservationValue } from './compare.js';
import { enumerateCandidates } from './enumerator.js';
import { replayCandidates } from './replay-runner.js';
import { resolveReplayWinners } from './resolve-winners.js';

// Regenerate with: node test/fixtures/demo/monthly-sales/generate.mjs
const fixture = (path: string) => fileURLToPath(new URL(`../../../../../test/fixtures/demo/monthly-sales/${path}`, import.meta.url));
const SOURCE_ID = 'input:orders';

async function read(path: string) {
  const materialize = localSheetModulePackage.materializeWorkbook!;
  return materialize(fixture(path));
}

async function firstTable(path: string): Promise<TableArtifact> {
  const { workbook, tables } = await read(path);
  return tables[workbook.sheets[0]!.tables[0]!.artifactId]!;
}

async function observe(exampleId: string, path: string): Promise<OutputObservation[]> {
  const { workbook, tables } = await read(path);
  return observeWorkbookArtifact(exampleId, workbook, tables);
}

describe('demo: monthly sales report learned from August, run on September', () => {
  it('learns the summary and the per-category table, then reproduces the true September report', async () => {
    const observations = await observe('ex_aug', 'output/월간매출요약_2026-08.xlsx');
    expect(observations.map((entry) => [entry.label, entry.value.kind])).toEqual([
      ['주문건수', 'number'],
      ['총매출', 'number'],
      ['평균주문금액', 'number'],
      ['카테고리별', 'table'],
    ]);
    const august = await firstTable('input/주문내역_2026-08.xlsx');
    const sources = [{ id: SOURCE_ID, connector: 'input_artifact', label: '주문내역_2026-08.xlsx', kind: 'workbook', relevance: 0.9 } as SourceDescriptor];
    const enumerated = enumerateCandidates(observations, sources, { [SOURCE_ID]: august });
    const replayed = replayCandidates({
      candidates: enumerated,
      examples: [{ exampleId: 'ex_aug', observations }],
      snapshotsByExample: { ex_aug: { [SOURCE_ID]: august } },
    });
    const required = observations.map((entry) => entry.path);
    const resolved = resolveReplayWinners(replayed, required);
    expect(resolved.ambiguousPaths).toEqual([]);

    const accepted = resolved.candidates.filter((candidate) => candidate.status === 'accepted');
    expect(Object.fromEntries(accepted.map((candidate) => [candidate.observationPath, formatMappingLabel(candidate)]))).toEqual({
      'field.주문건수': 'COUNT · 조건: 상태 ≠ 취소',
      'field.총매출': 'SUM(금액) · 조건: 상태 ≠ 취소',
      'field.평균주문금액': 'AVG(금액) 반올림(소수 0자리) · 조건: 상태 ≠ 취소',
      'field.카테고리별': '카테고리별 묶음: 주문건수=COUNT, 매출=SUM(금액) · 조건: 상태 ≠ 취소 · 정렬: 매출 큰 순 · 합계 줄 포함',
    });

    // The review card summarizes tables instead of dumping them.
    const tableWinner = accepted.find((candidate) => candidate.expr.op === 'group')!;
    expect(observationDisplay(observations[3]!)).toBe('5행 표 (카테고리, 주문건수, 매출)');
    expect(tableWinner.replayResults.map((entry) => [displayValue(entry.actual), entry.pass])).toEqual([['5행 표', true]]);

    // The session survives persistence (schema parse) and compiles to a publishable workflow.
    const now = new Date().toISOString();
    const session = DiscoverySessionStateSchema.parse({
      id: 'disc_demo',
      status: 'ready_to_publish',
      revision: 1,
      userGoal: '지난 결과물과 같은 방식으로 월간 매출 요약 만들기',
      exampleIds: ['ex_aug'],
      humanConfirmedAt: now,
      sourceInventory: sources,
      observations,
      candidates: resolved.candidates,
      budgets: { sourceReadsUsed: 1, sourceReadsMax: 10, elapsedMs: 1 },
      createdAt: now,
      updatedAt: now,
    });
    expect(buildConfirmationQuestion({ sessionId: session.id, candidates: session.candidates })?.context).toContain('카테고리별 묶음');
    expect(canPublish(session)).toEqual({ ok: true });
    const blueprint = buildDiscoveryBlueprint(session)!;
    expect(blueprint.outputContract?.fields.map((field) => [field.path, field.kind])).toContainEqual(['field.카테고리별', 'table']);
    const workflow = compileBlueprintToWorkflow(blueprint, { defaultSourcePath: fixture('next-month/주문내역_2026-09.xlsx') });
    const steps = workflow.steps.flatMap((step) =>
      step.type === 'action' && step.connector === 'transform' && step.action === 'evaluate' ? [step] : []);
    expect(steps).toHaveLength(4);

    // Run every compiled expression on September's orders and compare with the true September report.
    const september = await firstTable('next-month/주문내역_2026-09.xlsx');
    const truth = await observe('ex_sep', 'expected/월간매출요약_2026-09.xlsx');
    const fields: Record<string, unknown> = {};
    for (const step of steps) {
      const expr = TransformExprSchema.parse(step.params.expr);
      const outputPath = String(step.params.outputPath);
      fields[outputPath] = evaluateTransformExpr(expr, { [String(step.params.discoverySourceId)]: september });
      const expected = truth.find((entry) => entry.path === outputPath)!;
      expect(compareObservationValue(expected.value, fields[outputPath]), outputPath).toBe(1);
    }
    expect(validateOutputContract(workflow.outputContract!, { discoveryFields: fields }, {})).toEqual({ ok: true, issues: [] });

    // The report lists categories by 매출, largest first, total last; September's must too.
    const truthTable = truth.find((entry) => entry.path === 'field.카테고리별')!.value as { rows: Array<Record<string, unknown>> };
    const produced = fields['field.카테고리별'] as TableArtifact;
    expect(produced.rows.map((row) => row.values['카테고리'])).toEqual(truthTable.rows.map((row) => row['카테고리']));
  });
});
