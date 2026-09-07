import { describe, expect, it, vi } from 'vitest';
import type { InvestigationRunner, InvestigationRunRequest } from '../../../intelligence/agent/investigation-runner.js';
import { zodToCodexJsonSchema } from '../../../intelligence/agent/model/cli-json.js';
import { decodeCodexOutput } from '../../../intelligence/agent/model/cli-json/schema/decode-codex.js';
import { ReportEvidence, ReportEvidenceRequestSchema, ReportEvidenceDecisionSchema, inferWithEvidence, REPORT_EVIDENCE_TIMEOUT_MS } from './evidence.js';
import { ReportSourceReplanRequired } from './schema.js';

const sources = { ledger: { id: 'ledger', complete: true,
  rows: [{ amount: 12, note: 'private-a' }, { amount: 30, note: 'private-b' }, { amount: null }] } };
const plan = { schemaVersion: 1, baseSource: 'ledger', joins: [], scalars: [], tables: [], texts: [] };
function setup(outputs: unknown[]) {
  const seen: InvestigationRunRequest<unknown>[] = [];
  const runner: InvestigationRunner = { providerName: 'fixture', async run<T>(request: InvestigationRunRequest<T>) {
    seen.push(request);
    return { output: request.outputSchema.parse(outputs.shift()) };
  } };
  const readPage = vi.fn(() => ({ data: new Uint8Array([1]), mimeType: 'image/png' }));
  const input = { runner, context: { skillGoal: 'Infer', taskGoal: 'report',
    evidence: [], untrustedData: '{}', connectedConnectors: [] }, user: 'report',
    phase: 'report-business-plan', sources, pageCount: 2, readPage, maxChars: 80_000 };
  return { seen, input, readPage };
}
const request = (evidenceRequest: unknown) => ({ schemaVersion: 1, evidenceRequest });

describe('ReportEvidence', () => {
  it('makes calculation evidence geometry-first so page images are exceptional', async () => {
    const { input, seen } = setup([{ schemaVersion: 1, reportPlan: plan }]);
    await expect(inferWithEvidence(input)).resolves.toEqual(plan);
    expect(seen[0]!.context.skillGoal).toContain('reportGeometry already includes all page, slot and table structure');
    expect(seen[0]!.context.skillGoal).toContain('rowsTruncated, columnsTruncated, valuesTruncated and sampleOnly');
  });

  it('advertises the declarative operations before allowing unsupported abstention', async () => {
    const { input, seen } = setup([{ schemaVersion: 1, reportPlan: plan }]);
    await expect(inferWithEvidence(input)).resolves.toEqual(plan);
    expect(seen[0]!.context.skillGoal).toContain('joins, period predicates, aggregates, grouped tables, sort/limit, derived case expressions and arithmetic ratios');
    expect(seen[0]!.context.skillGoal).toContain('unsupported_operation only when the rule cannot be represented by these primitives');
    expect(seen[0]!.context.skillGoal).toContain('having predicates');
    expect(seen[0]!.context.skillGoal).toContain('{{scalar.<id>}}');
    expect(seen[0]!.context.skillGoal).toContain('{{meta.<key>}}');
  });

  it('requires more source rows before declaring an operation unsupported', async () => {
    const { input, seen } = setup([{ schemaVersion: 1, reportPlan: plan }]);
    await expect(inferWithEvidence(input)).resolves.toEqual(plan);
    expect(seen[0]!.context.skillGoal).toContain('A preview is never enough to declare an operation unsupported');
    expect(seen[0]!.context.skillGoal).toContain('request rows for the relevant source alias first');
  });

  it('allows bounded row pagination while keeping final calculations over every captured row', async () => {
    const { input, seen } = setup([{ schemaVersion: 1, reportPlan: plan }]);
    await expect(inferWithEvidence(input)).resolves.toEqual(plan);
    expect(seen[0]!.context.skillGoal).toContain('multiple distinct bounded row windows from the same source');
    expect(seen[0]!.context.skillGoal).toContain('the host computes the plan over every captured row');
  });

  it('allows the model to page through more than two distinct row windows from one source', async () => {
    const { input, seen } = setup([
      request({ kind: 'rows', source: 'ledger', columns: ['amount'], offset: 0, limit: 1 }),
      request({ kind: 'rows', source: 'ledger', columns: ['amount'], offset: 1, limit: 1 }),
      request({ kind: 'rows', source: 'ledger', columns: ['amount'], offset: 2, limit: 1 }),
      { schemaVersion: 1, reportPlan: plan },
    ]);
    await expect(inferWithEvidence(input)).resolves.toEqual(plan);
    expect(seen).toHaveLength(4);
    const thirdPage = JSON.parse(seen[3]!.context.untrustedData!);
    expect(thirdPage.evidence).toContainEqual(expect.objectContaining({
      request: { kind: 'rows', source: 'ledger', columns: ['amount'], offset: 2, limit: 1 },
      rowWindow: 3,
    }));
  });

  it('keeps repeated row windows in history without treating the source as exhausted', async () => {
    const { input, seen } = setup([
      request({ kind: 'rows', source: 'ledger', columns: ['amount'], offset: 0, limit: 1 }),
      request({ kind: 'rows', source: 'ledger', columns: ['amount'], offset: 1, limit: 1 }),
      { schemaVersion: 1, reportPlan: plan },
    ]);
    await expect(inferWithEvidence(input)).resolves.toEqual(plan);
    const data = JSON.parse(seen[2]!.context.untrustedData!);
    expect(data.evidence.at(-1)).toMatchObject({ rowWindow: 2,
      request: { source: 'ledger', offset: 1 } });
    expect(data.evidence.at(-1)?.rowBudgetExhausted).toBeUndefined();
  });

  it('does not spend calculation rounds rereading pages already represented by geometry', async () => {
    const { input, seen } = setup([{ schemaVersion: 1, reportPlan: plan }]);
    await expect(inferWithEvidence(input)).resolves.toEqual(plan);
    expect(seen[0]!.context.skillGoal).toContain('Do not request page images for a table or slot already described by reportGeometry');
    expect(seen[0]!.context.skillGoal).toContain('page evidence is allowed only when the corresponding geometry and example text are absent');
  });

  it('requires the smallest valid calculation plan instead of echoing optional structure', async () => {
    const { input, seen } = setup([{ schemaVersion: 1, reportPlan: plan }]);
    await expect(inferWithEvidence(input)).resolves.toEqual(plan);
    expect(seen[0]!.context.skillGoal).toContain('Return the smallest valid reusable calculation plan');
    expect(seen[0]!.context.skillGoal).toContain('omit optional fields and never echo evidence');
  });

  it('rechecks one conservative ambiguous decision before failing the report', async () => {
    const { input, seen } = setup([
      { schemaVersion: 1, unableToPlan: 'ambiguous_rule' },
      { schemaVersion: 1, reportPlan: plan },
    ]);
    await expect(inferWithEvidence(input)).resolves.toEqual(plan);
    expect(seen).toHaveLength(2);
    expect(seen[1]!.context.skillGoal).toContain('A previous ambiguous_rule or insufficient_evidence decision was not accepted as final');
    const data = JSON.parse(seen[1]!.context.untrustedData!);
    expect(data.evidence).toContainEqual({ unableToPlan: 'ambiguous_rule', recheckRequested: true });
  });

  it('still fails closed when ambiguity remains after the bounded recheck', async () => {
    const { input, seen } = setup([
      { schemaVersion: 1, unableToPlan: 'ambiguous_rule' },
      { schemaVersion: 1, unableToPlan: 'ambiguous_rule' },
    ]);
    await expect(inferWithEvidence(input)).rejects.toThrow('report_evidence_ambiguous_rule');
    expect(seen).toHaveLength(2);
  });

  it('uses a fast reasoning profile for initial plans and bounded revisions', async () => {
    const { input, seen } = setup([{ schemaVersion: 1, reportPlan: plan }]);
    await expect(inferWithEvidence(input)).resolves.toEqual(plan);
    expect((seen[0] as InvestigationRunRequest<unknown> & { codexReasoningEffort?: string }).codexReasoningEffort)
      .toBe('low');
    const revision = setup([{ schemaVersion: 1, reportPlan: plan }]);
    revision.input.phase = 'report-business-plan-revision';
    await expect(inferWithEvidence(revision.input)).resolves.toEqual(plan);
    expect((revision.seen[0] as InvestigationRunRequest<unknown> & { codexReasoningEffort?: string }).codexReasoningEffort)
      .toBe('low');
  });

  it('bootstraps bounded previews for every source after the first profile request', async () => {
    const { input, seen } = setup([
      request({ kind: 'profile', source: 'ledger', columns: ['amount'] }),
      { schemaVersion: 1, reportPlan: plan },
    ]);
    input.sources = {
      ledger: input.sources.ledger!,
      contacts: { id: 'contacts', complete: true,
        rows: [{ id: 'c1', name: 'Aster', privateNote: 'bounded-preview' }] },
    };
    await expect(inferWithEvidence(input)).resolves.toEqual(plan);
    const data = JSON.parse(seen[1]!.context.untrustedData!);
    expect(data.evidence).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'preview', source: 'ledger', rowCount: 3 }),
      expect.objectContaining({ kind: 'preview', source: 'contacts', rowCount: 1 }),
    ]));
    expect(seen[1]!.context.untrustedData).toContain('bounded-preview');
  });

  it('adds one bounded wider preview for the other sources after a rows request', async () => {
    const { input, seen } = setup([
      request({ kind: 'rows', source: 'ledger', columns: ['amount'], offset: 0, limit: 25 }),
      { schemaVersion: 1, reportPlan: plan },
    ]);
    input.sources = {
      ledger: input.sources.ledger!,
      contacts: { id: 'contacts', complete: true,
        rows: Array.from({ length: 30 }, (_, index) => ({ id: `c${index}`, name: `Contact ${index}` })) },
    };
    await expect(inferWithEvidence(input)).resolves.toEqual(plan);
    const data = JSON.parse(seen[1]!.context.untrustedData!);
    const contacts = data.evidence.find((entry: { kind?: string; source?: string }) => (
      entry.kind === 'preview' && entry.source === 'contacts'
    ));
    expect(contacts?.rows.length).toBeGreaterThan(5);
    expect(contacts?.rows.length).toBeLessThanOrEqual(25);
    expect(contacts?.rowCount).toBe(30);
  });

  it('keeps wider previews bounded even when source rows are wide', async () => {
    const { input, seen } = setup([
      request({ kind: 'rows', source: 'ledger', columns: ['amount'], offset: 0, limit: 25 }),
      { schemaVersion: 1, reportPlan: plan },
    ]);
    const wideRows = Array.from({ length: 30 }, (_, index) => Object.fromEntries(
      Array.from({ length: 16 }, (_, column) => [`field_${column}`, `${index}-${'x'.repeat(240)}`]),
    ));
    input.sources = {
      ledger: input.sources.ledger!,
      contacts: { id: 'contacts', complete: true, rows: wideRows },
      contracts: { id: 'contracts', complete: true, rows: wideRows },
      managers: { id: 'managers', complete: true, rows: wideRows },
    };
    await expect(inferWithEvidence(input)).resolves.toEqual(plan);
    expect(seen[1]!.context.untrustedData.length).toBeLessThanOrEqual(80_000);
  });

  it('compacts redundant previews under context pressure while retaining direct evidence', async () => {
    const { input, seen } = setup([
      request({ kind: 'profile', source: 'ledger', columns: ['amount'] }),
      { schemaVersion: 1, reportPlan: plan },
    ]);
    input.phase = 'report-business-plan-revision';
    input.context.untrustedData = JSON.stringify({ padding: 'x'.repeat(78_800) });
    input.sources = {
      ledger: input.sources.ledger!,
      contacts: { id: 'contacts', complete: true, rows: [{ id: 'contact-1', name: 'Aster' }] },
    };

    await expect(inferWithEvidence(input)).resolves.toEqual(plan);

    const secondContext = seen[1]!.context.untrustedData!;
    const data = JSON.parse(secondContext);
    expect(secondContext.length).toBeLessThanOrEqual(80_000);
    expect(data.evidence).toEqual(expect.arrayContaining([
      expect.objectContaining({ request: expect.objectContaining({ kind: 'profile', source: 'ledger' }) }),
      expect.objectContaining({ kind: 'preview', source: 'contacts' }),
    ]));
    expect(data.evidence).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'preview', source: 'ledger' }),
    ]));
  });

  it('labels direct row evidence compacted for context without changing its source count', async () => {
    const { input, seen } = setup([
      request({ kind: 'rows', source: 'ledger', columns: ['amount'], offset: 0, limit: 25 }),
      { schemaVersion: 1, reportPlan: plan },
    ]);
    input.context.untrustedData = JSON.stringify({ padding: 'x'.repeat(72_000) });
    input.sources = { ledger: { id: 'ledger', complete: true,
      rows: Array.from({ length: 10 }, (_, amount) => ({ amount: `${amount}-${'x'.repeat(1_000)}` })) } };

    await expect(inferWithEvidence(input)).resolves.toEqual(plan);
    const data = JSON.parse(seen[1]!.context.untrustedData!);
    const rowsEvidence = data.evidence.find((entry: { request?: { kind?: string } }) => entry.request?.kind === 'rows');
    expect(rowsEvidence.result).toMatchObject({ rowCount: 10, sampleOnly: true,
      contextCompacted: true, omittedRowCount: 4 });
    expect(rowsEvidence.result.rows).toHaveLength(6);
  });

  it('retries a bounded invalid calculation plan and carries only structural issues forward', async () => {
    const { input } = setup([]);
    let calls = 0;
    input.runner = { providerName: 'fixture', async run<T>(request: InvestigationRunRequest<T>) {
      calls += 1;
      if (calls === 1) throw Object.assign(new Error('model_output_invalid'), {
        code: 'model_output_invalid',
        issues: [{ code: 'invalid_union', path: ['reportPlan', 'tables', 0, 'columns', 3, 'value'],
          received: 'private-model-output' }],
      });
      const data = JSON.parse(request.context.untrustedData!);
      expect(data.validationIssues).toEqual([{ code: 'invalid_union',
        path: ['reportPlan', 'tables', 0, 'columns', 3, 'value'] }]);
      expect(request.context.untrustedData).not.toContain('private-model-output');
      return { output: request.outputSchema.parse({ schemaVersion: 1, reportPlan: plan }) };
    } };
    await expect(inferWithEvidence(input)).resolves.toEqual(plan);
    expect(calls).toBe(2);
  });

  it('allows one additional structural correction for an invalid aggregate table filter', async () => {
    const { input, seen } = setup([]);
    let calls = 0;
    input.runner = { providerName: 'fixture', async run<T>(request: InvestigationRunRequest<T>) {
      seen.push(request);
      calls += 1;
      if (calls < 3) throw Object.assign(new Error('model_output_invalid'), {
        code: 'model_output_invalid',
        issues: [{ code: 'invalid_union', path: ['reportPlan', 'tables', 0, 'filter'] }],
      });
      return { output: request.outputSchema.parse({ schemaVersion: 1, reportPlan: plan }) };
    } };

    await expect(inferWithEvidence(input)).resolves.toEqual(plan);
    expect(calls).toBe(3);
    expect(seen[1]!.context.skillGoal).toContain('aggregate table filter accepts only row-level field predicates');
  });

  it('retries a semantically unsafe plan with only a bounded validation path', async () => {
    const { input, seen } = setup([
      request({ kind: 'profile', source: 'ledger', columns: ['amount'] }),
      { schemaVersion: 1, reportPlan: plan },
      { schemaVersion: 1, reportPlan: plan },
    ]);
    let calls = 0;
    (input as typeof input & { validatePlan?: (candidate: unknown) => void }).validatePlan = () => {
      calls += 1;
      if (calls === 1) throw new Error('report_plan_output_not_source_derived:scalar.source_summary');
    };
    await expect(inferWithEvidence(input)).resolves.toEqual(plan);
    expect(calls).toBe(2);
    const data = JSON.parse(seen[2]!.context.untrustedData!);
    expect(data.validationIssues).toEqual([{ code: 'report_plan_output_not_source_derived',
      path: ['scalar', 'source_summary'] }]);
  });

  it('allows a third semantic correction when earlier plans keep changing shape', async () => {
    const { input } = setup([
      { schemaVersion: 1, reportPlan: plan },
      { schemaVersion: 1, reportPlan: plan },
      { schemaVersion: 1, reportPlan: plan },
      { schemaVersion: 1, reportPlan: plan },
    ]);
    let validations = 0;
    input.validatePlan = () => {
      validations += 1;
      if (validations <= 3) throw new Error('report_plan_field_source_not_joined:root.team_roster');
    };

    await expect(inferWithEvidence(input)).resolves.toEqual(plan);
    expect(validations).toBe(4);
  });

  it('gives the model an actionable correction when a dataset omits a required join', async () => {
    const { input, seen } = setup([
      { schemaVersion: 1, reportPlan: plan },
      { schemaVersion: 1, reportPlan: plan },
    ]);
    let validations = 0;
    input.validatePlan = () => {
      validations += 1;
      if (validations === 1) throw new Error('report_plan_field_source_not_joined:recognized_orders.contracts');
    };

    await expect(inferWithEvidence(input)).resolves.toEqual(plan);
    expect(seen[1]!.context.skillGoal).toContain('captured source contracts without a join');
    expect(JSON.parse(seen[1]!.context.untrustedData!).validationIssues).toEqual([{
      code: 'report_plan_field_source_not_joined', path: ['recognized_orders', 'contracts'],
    }]);
  });

  it('gives the model an actionable correction when result tables omit detected groups', async () => {
    const { input, seen } = setup([
      { schemaVersion: 1, reportPlan: plan },
      { schemaVersion: 1, reportPlan: plan },
    ]);
    let validations = 0;
    input.validatePlan = () => {
      validations += 1;
      if (validations === 1) throw new Error('report_plan_table_coverage_incomplete:customer_summary');
    };

    await expect(inferWithEvidence(input)).resolves.toEqual(plan);
    expect(seen[1]!.context.skillGoal).toContain('every detected PDF table group needs its own compatible result table');
    expect(JSON.parse(seen[1]!.context.untrustedData!).validationIssues).toEqual([{
      code: 'report_plan_table_coverage_incomplete', path: ['customer_summary'],
    }]);
  });

  it('retains an earlier table structure when a correction response omits it', async () => {
    const completePlan = {
      ...plan,
      tables: [{ kind: 'aggregate' as const, id: 'summary', groupBy: [{ id: 'key', value: { kind: 'field' as const, path: 'ledger.key' } }],
        columns: [{ id: 'key', value: { kind: 'group_key' as const, keyId: 'key' } }] }],
    };
    const { input } = setup([
      { schemaVersion: 1, reportPlan: completePlan },
      { schemaVersion: 1, reportPlan: plan },
    ]);
    let validations = 0;
    input.validatePlan = (candidate) => {
      validations += 1;
      if (validations === 1) throw new Error('report_plan_output_not_source_derived:scalar.total');
      if (candidate.tables.length === 0) throw new Error('report_plan_table_coverage_incomplete:summary');
    };

    const recovered = await inferWithEvidence(input);
    expect(recovered.tables).toEqual(completePlan.tables);
    expect(validations).toBe(3);
  });

  it('carries the rejected plan into semantic correction so the model can repair it', async () => {
    const unsafePlan = {
      ...plan,
      scalars: [{ id: 'copied', expression: { kind: 'literal', value: 'copied prose' } }],
    };
    const { input, seen } = setup([
      { schemaVersion: 1, reportPlan: unsafePlan },
      { schemaVersion: 1, reportPlan: plan },
    ]);
    let validations = 0;
    (input as typeof input & { validatePlan?: (candidate: unknown) => void }).validatePlan = (candidate) => {
      validations += 1;
      if (validations === 1) {
        expect(candidate).toEqual(unsafePlan);
        throw new Error('report_plan_output_not_source_derived:scalar.source_summary');
      }
    };

    await expect(inferWithEvidence(input)).resolves.toEqual(plan);
    const data = JSON.parse(seen[1]!.context.untrustedData!);
    expect(data.rejectedReportPlan).toEqual(unsafePlan);
    expect(data.validationIssues).toEqual([{ code: 'report_plan_output_not_source_derived',
      path: ['scalar', 'source_summary'] }]);
  });

  it('keeps a correction turn after the bounded evidence request budget is spent', async () => {
    const { input, seen } = setup([
      request({ kind: 'profile', source: 'ledger', columns: ['amount'] }),
      request({ kind: 'rows', source: 'ledger', columns: ['amount'], offset: 0, limit: 1 }),
      request({ kind: 'rows', source: 'ledger', columns: ['amount'], offset: 1, limit: 1 }),
      request({ kind: 'page', document: 'example', pageIndex: 0 }),
      request({ kind: 'page', document: 'example', pageIndex: 1 }),
      request({ kind: 'rows', source: 'ledger', columns: ['amount'], offset: 2, limit: 1 }),
      request({ kind: 'rows', source: 'ledger', columns: ['amount'], offset: 0, limit: 2 }),
      request({ kind: 'profile', source: 'ledger', columns: ['note'] }),
      { schemaVersion: 1, reportPlan: plan },
      { schemaVersion: 1, reportPlan: plan },
    ]);
    let validations = 0;
    input.validatePlan = () => {
      validations += 1;
      if (validations === 1) throw new Error('report_plan_output_not_source_derived:table.risk.column.label');
    };

    await expect(inferWithEvidence(input)).resolves.toEqual(plan);
    expect(seen).toHaveLength(10);
    const correction = JSON.parse(seen[9]!.context.untrustedData!);
    expect(correction.remainingEvidenceRequests).toBe(0);
    expect(correction.validationIssues).toEqual([{ code: 'report_plan_output_not_source_derived',
      path: ['table', 'risk', 'column', 'label'] }]);
  });
  it('returns a typed missing-source request without reading data or executing actions', async () => {
    const needs = [{ id: 'missing', connector: 'rdb', description: 'Service agreements', reason: 'The existing source has no agreement dates' }];
    const { input, seen, readPage } = setup([
      { schemaVersion: 1, sourceRequest: needs },
      { schemaVersion: 1, sourceRequest: needs },
    ]);
    await expect(inferWithEvidence(input)).rejects.toBeInstanceOf(ReportSourceReplanRequired);
    expect(seen).toHaveLength(2);
    expect(readPage).not.toHaveBeenCalled();
    for (const action of [{ url: 'https://unlisted.test' }, { sql: 'SELECT * FROM secret' }, { method: 'POST' }]) {
      expect(ReportEvidenceDecisionSchema.safeParse({ schemaVersion: 1,
        sourceRequest: [{ ...needs[0], ...action }] }).success).toBe(false);
    }
    expect(ReportEvidenceDecisionSchema.safeParse({ schemaVersion: 1, sourceRequest: needs,
      reportPlan: plan }).success).toBe(false);
  });
  it('rechecks a source request once before triggering source replanning', async () => {
    const needs = [{ id: 'possibly-present', connector: 'http', description: 'Order amounts', reason: 'The calculation needs amount fields' }];
    const { input, seen } = setup([
      { schemaVersion: 1, sourceRequest: needs },
      { schemaVersion: 1, reportPlan: plan },
    ]);
    await expect(inferWithEvidence(input)).resolves.toEqual(plan);
    expect(seen).toHaveLength(2);
    const correction = JSON.parse(seen[1]!.context.untrustedData!);
    expect(correction.validationIssues).toEqual([{ code: 'report_source_request_recheck', path: [] }]);
    expect(correction.evidence.at(-1)).toMatchObject({ sourceRequest: needs, recheckRequested: true });
    expect(seen[1]!.context.skillGoal).toContain('sourceRequest was not accepted for immediate replanning');
  });
  it('summarizes without row values and projects only selected columns/rows', () => {
    const evidence = new ReportEvidence(sources);
    expect(JSON.stringify(evidence.summary())).not.toContain('private');
    expect(evidence.read({ kind: 'rows', source: 'ledger', columns: ['amount'], offset: 1, limit: 1 }))
      .toMatchObject({ rows: [{ amount: 30 }], nextOffset: 2, rowCount: 3, sampleOnly: true });
    expect(evidence.read({ kind: 'profile', source: 'ledger', columns: ['amount'] }))
      .toMatchObject({ profiles: [{ nulls: 1, minimum: 12, maximum: 30 }] });
  });

  it('normalizes undefined source fields to explicit null evidence', () => {
    const evidence = new ReportEvidence({ facts: { id: 'facts', complete: true,
      rows: [{ amount: undefined }] } });
    expect(evidence.read({ kind: 'rows', source: 'facts', columns: ['amount'], offset: 0, limit: 1 }))
      .toMatchObject({ rows: [{ amount: null }] });
    expect(evidence.read({ kind: 'profile', source: 'facts', columns: ['amount'] }))
      .toMatchObject({ profiles: [{ nulls: 1, types: {} }] });
    expect(evidence.preview('facts')).toMatchObject({ rows: [{ amount: null }], valuesTruncated: false });
  });

  it('reports numeric totals and bounded conditional totals for categorical filters', () => {
    const evidence = new ReportEvidence({ orders: { id: 'orders', complete: true, rows: [
      { status: 'PAID', gross_amount: '100.00', net_amount: '100.00', refund_amount: '0.00' },
      { status: 'PARTIALLY_REFUNDED', gross_amount: '200.00', net_amount: '150.00', refund_amount: '50.00' },
      { status: 'REFUNDED', gross_amount: '300.00', net_amount: '0.00', refund_amount: '300.00' },
    ] } }, { detailedProfiles: true });
    const profile = evidence.read({ kind: 'profile', source: 'orders',
      columns: ['status', 'gross_amount', 'net_amount', 'refund_amount'] }) as {
      profiles: Array<{ column: string; numericSum?: number }>;
      groupedNumeric?: Array<{ column: string; groups: Array<{ value: unknown; rowCount: number; numeric: Array<{ column: string; sum: number }> }> }>;
    };
    expect(profile.profiles.find(item => item.column === 'gross_amount')).toMatchObject({ numericSum: 600 });
    expect(profile.groupedNumeric).toContainEqual(expect.objectContaining({
      column: 'status',
      groups: expect.arrayContaining([
        expect.objectContaining({ value: 'PARTIALLY_REFUNDED', rowCount: 1,
          numeric: expect.arrayContaining([expect.objectContaining({ column: 'refund_amount', sum: 50 })]) }),
      ]),
    }));
  });

  it('keeps wide profiles usable by compacting optional distinct examples with flags', () => {
    const rows = Array.from({ length: 30 }, (_, index) => Object.fromEntries(
      Array.from({ length: 12 }, (_unused, column) => [`field${column}`, `${index}-${'x'.repeat(190)}`]),
    ));
    const evidence = new ReportEvidence({ facts: { id: 'facts', complete: true, rows } });
    const profile = evidence.read({ kind: 'profile', source: 'facts', columns: Array.from({ length: 12 }, (_unused, column) => `field${column}`) }) as {
      profiles: Array<{ distinctExamples: unknown[]; distinctExamplesComplete: boolean; omittedDistinctExamples?: number }>;
      profileContextCompacted?: boolean;
    };
    expect(profile.profileContextCompacted).toBe(true);
    expect(profile.profiles.every((item) => item.distinctExamplesComplete === false)).toBe(true);
    expect(profile.profiles.every((item) => (item.omittedDistinctExamples ?? 0) > 0)).toBe(true);
    expect(JSON.stringify(profile).length).toBeLessThanOrEqual(16_000);
  });

  it('discovers late fields and marks bounded distinct examples as incomplete', () => {
    const evidence = new ReportEvidence({ unusual: { id: 'unusual', complete: true,
      rows: [...Array.from({ length: 30 }, (_, index) => ({ code: `v${index}` })), { rare: true }] } });
    expect(evidence.summary()[0]?.columns).toEqual(['code', 'rare']);
    expect(evidence.read({ kind: 'profile', source: 'unusual', columns: ['code'] }))
      .toMatchObject({ profiles: [{ missing: 1, distinctExamplesComplete: false }] });
  });

  it('labels every preview reduction so the model cannot mistake it for the source', () => {
    const rows = Array.from({ length: 30 }, (_, index) => ({
      id: index, a_value: 'x'.repeat(600),
      ...Object.fromEntries(Array.from({ length: 16 }, (_unused, column) => [`c${column}`, column])),
    }));
    const evidence = new ReportEvidence({ facts: { id: 'facts', complete: true, rows } });
    expect(evidence.preview('facts')).toMatchObject({
      rowCount: 30,
      nextOffset: 5,
      rowsTruncated: true,
      columnsTruncated: true,
      valuesTruncated: true,
      sampleOnly: true,
    });
  });

  it('rejects an incomplete snapshot before the model can infer a plan from it', () => {
    expect(() => new ReportEvidence({ facts: { id: 'facts', complete: false, rows: [{ id: 1 }] } }))
      .toThrow('report_evidence_source_incomplete:facts');
  });

  it('labels grouped profile reductions when low-cardinality summaries exceed their bounds', () => {
    const rows = Array.from({ length: 4 }, (_, index) => Object.fromEntries([
      ...Array.from({ length: 10 }, (_unused, column) => [`amount${column}`, index + column]),
      ...Array.from({ length: 2 }, (_unused, column) => [`group${column}`, `v${index}`]),
    ]));
    const evidence = new ReportEvidence({ facts: { id: 'facts', complete: true, rows } }, { detailedProfiles: true });
    expect(evidence.read({ kind: 'profile', source: 'facts', columns: [
      ...Array.from({ length: 10 }, (_unused, column) => `amount${column}`),
      ...Array.from({ length: 2 }, (_unused, column) => `group${column}`),
    ].slice(0, 12) })).toMatchObject({
      numericColumnsTruncated: true,
      groupedNumericTruncated: true,
    });
  });

  it('rejects unknown sources, inherited keys, unknown columns and invalid offsets', () => {
    const evidence = new ReportEvidence(sources);
    for (const source of ['invented', '__proto__', 'constructor']) {
      expect(() => evidence.read({ kind: 'profile', source, columns: ['amount'] })).toThrow('report_evidence_source_invalid');
    }
    expect(() => evidence.read({ kind: 'profile', source: 'ledger', columns: ['invented'] })).toThrow('report_evidence_column_invalid');
    expect(() => evidence.read({ kind: 'rows', source: 'ledger', columns: ['amount'], offset: 4, limit: 1 })).toThrow('report_evidence_offset_invalid');
    expect(ReportEvidenceRequestSchema.safeParse({ kind: 'rows', source: 'ledger', columns: ['amount'], offset: -1, limit: 99 }).success).toBe(false);
  });

  it('does not silently truncate oversized selected values', () => {
    const evidence = new ReportEvidence({ large: { id: 'large', complete: true, rows: [{ text: 'x'.repeat(20_000) }] } });
    expect(() => evidence.read({ kind: 'rows', source: 'large', columns: ['text'], offset: 0, limit: 1 })).toThrow('report_evidence_context_limit');
  });

  it('selectively loads evidence and pages before accepting a plan', async () => {
    const { input, seen, readPage } = setup([
      request({ kind: 'rows', source: 'ledger', columns: ['amount'], offset: 0, limit: 1 }),
      request({ kind: 'page', document: 'example', pageIndex: 1 }), { schemaVersion: 1, reportPlan: plan },
    ]);
    await expect(inferWithEvidence(input)).resolves.toEqual(plan);
    expect(seen[0]?.images).toBeUndefined();
    expect(seen[1]?.context.untrustedData).not.toContain('private');
    expect(seen[1]?.context.untrustedData).toContain('sampleOnly');
    expect(readPage).toHaveBeenCalledExactlyOnceWith('example', 1);
    expect(seen[2]?.images).toHaveLength(1);
    expect(sources.ledger.rows).toHaveLength(3);
  });

  it('rejects repeated evidence requests and invalid page numbers', async () => {
    const same = request({ kind: 'profile', source: 'ledger', columns: ['amount'] });
    await expect(inferWithEvidence(setup([same, same]).input)).rejects.toThrow('report_evidence_no_progress');
    const invalid = setup([request({ kind: 'page', document: 'template', pageIndex: 2 })]);
    await expect(inferWithEvidence(invalid.input)).rejects.toThrow('report_evidence_page_invalid');
    expect(invalid.readPage).not.toHaveBeenCalled();
  });

  it('enforces an aggregate deadline even if a runner does not settle', async () => {
    vi.useFakeTimers();
    try {
      const { input } = setup([]);
      input.runner.run = () => new Promise(() => {});
      const pending = expect(inferWithEvidence(input)).rejects.toThrow('report_evidence_deadline_exceeded');
      await vi.advanceTimersByTimeAsync(REPORT_EVIDENCE_TIMEOUT_MS + 1);
      await pending;
      expect(vi.getTimerCount()).toBe(0);
    } finally { vi.useRealTimers(); }
  });

  it('retries one transient agent timeout without repeating evidence reads', async () => {
    const { input, seen } = setup([]);
    let calls = 0;
    input.runner = { providerName: 'fixture', async run<T>(request: InvestigationRunRequest<T>) {
      seen.push(request);
      calls += 1;
      if (calls === 1) return { output: request.outputSchema.parse({ schemaVersion: 1,
        evidenceRequest: { kind: 'profile', source: 'ledger', columns: ['amount'] } }) };
      if (calls === 2) throw Object.assign(new Error('Agent timed out'), { code: 'agent_timeout' });
      return { output: request.outputSchema.parse({ schemaVersion: 1, reportPlan: plan }) };
    } };

    await expect(inferWithEvidence(input)).resolves.toEqual(plan);
    expect(calls).toBe(3);
    const data = JSON.parse(seen[2]!.context.untrustedData!);
    expect(data.evidence.filter((entry: { request?: { kind?: string } }) => entry.request?.kind === 'profile'))
      .toHaveLength(1);
  });

  it('bounds evidence requests and image bytes', async () => {
    const many = setup([
      ...Array.from({ length: 9 }, (_, offset) => request({ kind: 'rows', source: 'ledger', columns: ['amount'], offset, limit: 1 })),
      { schemaVersion: 1, reportPlan: plan },
    ]);
    many.input.sources = { ledger: { id: 'ledger', complete: true, rows: Array.from({ length: 10 }, () => ({ amount: 1, note: '' })) } };
    await expect(inferWithEvidence(many.input)).rejects.toThrow('report_evidence_round_limit');
    const large = setup([request({ kind: 'page', document: 'example', pageIndex: 0 })]);
    large.input.readPage = () => ({ data: new Uint8Array(9 * 1024 * 1024), mimeType: 'image/png' });
    await expect(inferWithEvidence(large.input)).rejects.toThrow('report_evidence_image_limit');
  });

  it('produces a supported wire schema', () => {
    const schema = zodToCodexJsonSchema(ReportEvidenceDecisionSchema);
    expect(schema).toMatchObject({ type: 'object' });
    expect(ReportEvidenceDecisionSchema.safeParse({ schemaVersion: 1 }).success).toBe(false);
    expect(ReportEvidenceDecisionSchema.safeParse({ schemaVersion: 1, reportPlan: plan,
      evidenceRequest: { kind: 'profile', source: 'ledger', columns: ['amount'] } }).success).toBe(false);
  });

  it('allows a model to abstain without fabricating a plan', async () => {
    await expect(inferWithEvidence(setup([
      { schemaVersion: 1, unableToPlan: 'ambiguous_rule' },
      { schemaVersion: 1, unableToPlan: 'ambiguous_rule' },
    ]).input))
      .rejects.toThrow('report_evidence_ambiguous_rule');
  });

  it('rechecks a single unsupported abstention before failing closed', async () => {
    const { input, seen } = setup([
      { schemaVersion: 1, unableToPlan: 'unsupported_operation' },
      { schemaVersion: 1, reportPlan: plan },
    ]);

    await expect(inferWithEvidence(input)).resolves.toEqual(plan);

    expect(seen).toHaveLength(2);
    expect(seen[1]!.context.skillGoal).toContain('previous unsupported_operation');
    expect(JSON.parse(seen[1]!.context.untrustedData!)).toMatchObject({
      validationIssues: [{ code: 'report_evidence_unsupported_operation', path: [] }],
    });
  });

  it('bounds unsupported-operation recovery to one recheck', async () => {
    const { input, seen } = setup([
      { schemaVersion: 1, unableToPlan: 'unsupported_operation' },
      { schemaVersion: 1, unableToPlan: 'unsupported_operation' },
    ]);

    await expect(inferWithEvidence(input)).rejects.toThrow('report_evidence_unsupported_operation');
    expect(seen).toHaveLength(2);
  });

  it('restores optional payloads and encoded evidence through the actual Codex decoder', () => {
    const sourceRequest = [{ id: 'agreements', connector: 'rdb', description: 'Agreement dates', reason: 'Missing from captured data' }];
    expect(ReportEvidenceDecisionSchema.parse(decodeCodexOutput({ schemaVersion: 1,
      reportPlan: null, evidenceRequest: null, sourceRequest, unableToPlan: null }, ReportEvidenceDecisionSchema)))
      .toEqual({ schemaVersion: 1, sourceRequest });
    const evidenceRequest = { kind: 'rows', source: 'ledger', columns: ['amount'], offset: 0, limit: 2 };
    const decoded = decodeCodexOutput({ schemaVersion: 1, reportPlan: null,
      evidenceRequest: JSON.stringify(evidenceRequest), unableToPlan: null }, ReportEvidenceDecisionSchema);
    expect(ReportEvidenceDecisionSchema.parse(decoded)).toEqual({ schemaVersion: 1, evidenceRequest });
    expect(ReportEvidenceDecisionSchema.parse(decodeCodexOutput({ schemaVersion: 1,
      reportPlan: null, evidenceRequest: null, unableToPlan: 'insufficient_evidence' }, ReportEvidenceDecisionSchema)))
      .toEqual({ schemaVersion: 1, unableToPlan: 'insufficient_evidence' });
  });
});
