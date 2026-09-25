import { describe, expect, it, vi } from 'vitest';
import type { DecisionAnswer, DecisionEngine, DecisionEvaluationRequest } from '../../../contracts/decision.js';
import type { InvestigationRunner, InvestigationRunRequest } from '../../../intelligence/agent/investigation-runner.js';
import type { PdfReportPairAnalysis } from '../../read/types/pdf.js';
import { ReportPlanner } from './planner.js';
import { selectAndInspectReportSources } from './source-candidates.js';

const pair: PdfReportPairAnalysis = {
  schemaVersion: 1, pairId: 'pair', templateHash: 'template', exampleHash: 'example', pageCount: 1,
  pages: [], scalarSlots: [{ id: 'customer', pageIndex: 0, rect: { x: 0, y: 0, width: 1, height: 1 },
    exampleText: 'Confidential Buyer Name', fontSize: 10, font: 'test', color: 0 }],
  tableGroups: [], templateImages: [], exampleImages: [],
};

type SourceChoice = 'use_source' | 'skip_source' | 'unclear';

function chosenQuestions(request: DecisionEvaluationRequest, choiceFor: (id: string) => SourceChoice) {
  return Object.fromEntries(Object.keys(request.questions).map(id => [id, {
    type: 'choice' as const,
    choice: choiceFor(id),
    probabilities: { use_source: 0.4, skip_source: 0.35, unclear: 0.25 },
    confidence: 0.4,
  }]));
}

describe('Jev report source candidates', () => {
  const capturePlanForTable = (table: string) => ({ schemaVersion: 1, status: 'planned', plan: {
    schemaVersion: 1,
    examplePeriod: { start: '2040-01-01', endInclusive: '2040-01-31', label: 'example' },
    targetPeriod: { start: '2040-02-01', endInclusive: '2040-02-29', label: 'target' },
    capturePlan: { schemaVersion: 1, http: [], rdb: [{ alias: 'orders', table }] },
    requirementBindings: [{ requirementId: 'source-rdb', aliases: ['orders'] }],
  } });

  it('preloads only selected, allowed source metadata before the first plan call', async () => {
    const decisionRequests: DecisionEvaluationRequest[] = [];
    const logs: Array<{ code?: string; data?: unknown }> = [];
    const decisionEngine: DecisionEngine = { async evaluate(request) {
      decisionRequests.push(request);
      return { answers: chosenQuestions(request, id => id === 'source_0' ? 'use_source' : 'skip_source'),
        model: 'jev-test', providerRequestCount: 2, usage: { inputTokens: 44, outputTokens: 2 } };
    } };
    const inspect = vi.fn(async (request: { kind?: string; table?: string }) => ({
      table: request.table, columns: [{ name: 'order_date', type: 'date' }],
    }));
    const plan = { schemaVersion: 1, status: 'planned', plan: {
      schemaVersion: 1,
      examplePeriod: { start: '2040-01-01', endInclusive: '2040-01-31', label: 'example' },
      targetPeriod: { start: '2040-02-01', endInclusive: '2040-02-29', label: 'target' },
      capturePlan: { schemaVersion: 1, http: [], rdb: [{ alias: 'orders', table: 'warehouse.orders' }] },
      requirementBindings: [{ requirementId: 'source-rdb', aliases: ['orders'] }],
    } };
    const modelRequests: InvestigationRunRequest<unknown>[] = [];
    const runner: InvestigationRunner = { providerName: 'test', async run<T>(request: InvestigationRunRequest<T>) {
      modelRequests.push(request);
      return { output: request.outputSchema.parse(plan) };
    } };
    const planner = new ReportPlanner(runner, { decisionEngine });

    await expect(planner.inferCapturePlan({
      goal: 'Summarize monthly orders', pair, httpConnections: [],
      rdbTables: ['warehouse.orders', 'warehouse.audit'], connectedConnectors: ['rdb'],
      requirements: [{ id: 'source-rdb', connector: 'rdb', description: 'Order records', reason: 'Report request' }],
      inspectSource: inspect, log: entry => logs.push(entry),
    })).resolves.toMatchObject({ capturePlan: { rdb: [{ table: 'warehouse.orders' }] } });

    expect(decisionRequests).toHaveLength(1);
    expect(Object.keys(decisionRequests[0]!.questions)).toEqual(['source_0', 'source_1']);
    expect(decisionRequests[0]!.questions.source_0).toMatchObject({
      type: 'choice', criteria: { use_source: expect.any(String), skip_source: expect.any(String), unclear: expect.any(String) },
    });
    expect(JSON.stringify(decisionRequests[0]!.state)).not.toContain('Confidential Buyer Name');
    expect(inspect).toHaveBeenCalledExactlyOnceWith({ kind: 'rdb_table', table: 'warehouse.orders', limit: 20 }, expect.any(AbortSignal));
    expect(modelRequests).toHaveLength(1);
    expect(logs).toMatchObject([{ code: 'report_source_candidates_jev_completed', data: {
      candidateCount: 2, selectedCount: 1, providerRequestCount: 2, model: 'jev-test', inputTokens: 44, outputTokens: 2,
    } }]);
    expect(JSON.parse(modelRequests[0]!.context.untrustedData!).inspectedEvidence).toEqual([
      { request: { kind: 'rdb_table', table: 'warehouse.orders' },
        result: { table: 'warehouse.orders', columns: [{ name: 'order_date', type: 'date' }] } },
    ]);
  });

  it('sends only configured GET-without-side-effect operations as candidates and never makes an HTTP request', async () => {
    const decisionEngine: DecisionEngine = { async evaluate(request) {
      return { answers: chosenQuestions(request, () => 'use_source') };
    } };
    const result = await selectAndInspectReportSources({
      decisionEngine, goal: 'Read customers', pair: { ...pair, scalarSlots: [] }, requirements: [
        { id: 'source-http', connector: 'http', description: 'Customer data', reason: 'Report request' },
      ], rdbTables: [], inspectSource: vi.fn(), httpConnections: [{ id: 'customers-api', label: 'Customers', basePath: '/',
        operations: [
          { operationId: 'list', method: 'GET', path: '/customers', sideEffect: 'NONE', summary: 'List customers' },
          { operationId: 'create', method: 'POST', path: '/customers', sideEffect: 'NONE', summary: 'Create customer' },
          { operationId: 'unsafe', method: 'GET', path: '/unsafe', sideEffect: 'EXTERNAL', summary: 'Not a read' },
        ] }],
    });

    expect(result).toHaveLength(1);
    expect(result[0]?.request).toEqual({ kind: 'http_operation', connectionId: 'customers-api', path: '/customers' });
    expect(JSON.stringify(result[0]?.result)).toContain('List customers');
  });

  it('fails closed when Jev omits a candidate answer instead of treating it as a negative choice', async () => {
    const inspect = vi.fn();
    const logs: Array<{ code?: string; data?: unknown }> = [];
    await expect(selectAndInspectReportSources({
      decisionEngine: { evaluate: async () => ({ answers: {}, model: 'jev-test', providerRequestCount: 2,
        usage: { inputTokens: 31, outputTokens: 1 } }) },
      goal: 'Read orders',
      pair: { ...pair, scalarSlots: [] },
      requirements: [{ id: 'source-http', connector: 'http', description: 'Orders', reason: 'Report request' }],
      httpConnections: [{ id: 'orders-api', label: 'Orders', basePath: '/', operations: [
        { operationId: 'list', method: 'GET', path: '/orders', sideEffect: 'NONE' },
      ] }],
      rdbTables: [],
      inspectSource: inspect,
      log: entry => logs.push(entry),
    })).rejects.toMatchObject({ code: 'report_source_candidate_jev_answer_invalid' });

    expect(inspect).not.toHaveBeenCalled();
    expect(logs).toMatchObject([{ code: 'report_source_candidates_jev_answer_invalid', data: {
      candidateCount: 1, candidateId: 'source_0', reason: 'missing', providerRequestCount: 2,
      model: 'jev-test', inputTokens: 31, outputTokens: 1,
    } }]);
  });

  it.each([
    ['boolean answer', { type: 'boolean', probability: 1 }, 'wrong_type'],
    ['unlisted choice', { type: 'choice', choice: 'guess', probabilities: { guess: 1 } }, 'unlisted_choice'],
  ] as const)('rejects %s before inspecting candidates', async (_label, answer, reason) => {
    const inspect = vi.fn();
    const logs: Array<{ code?: string; data?: unknown }> = [];
    const decisionEngine: DecisionEngine = { async evaluate(request) {
      const candidateId = Object.keys(request.questions)[0]!;
      return { answers: { [candidateId]: answer as DecisionAnswer } };
    } };

    await expect(selectAndInspectReportSources({
      decisionEngine,
      goal: 'Read orders',
      pair: { ...pair, scalarSlots: [] },
      requirements: [{ id: 'source-http', connector: 'http', description: 'Orders', reason: 'Report request' }],
      httpConnections: [{ id: 'orders-api', label: 'Orders', basePath: '/', operations: [
        { operationId: 'list', method: 'GET', path: '/orders', sideEffect: 'NONE' },
      ] }],
      rdbTables: [],
      inspectSource: inspect,
      log: entry => logs.push(entry),
    })).rejects.toMatchObject({ code: 'report_source_candidate_jev_answer_invalid' });

    expect(inspect).not.toHaveBeenCalled();
    expect(logs).toMatchObject([{ code: 'report_source_candidates_jev_answer_invalid', data: {
      candidateId: 'source_0', reason,
    } }]);
  });

  it('does not reauthorize a configured HTTP operation that is not a side-effect-free GET', async () => {
    const evaluate = vi.fn(async () => ({ answers: {} }));
    const inspect = vi.fn();
    const result = await selectAndInspectReportSources({
      decisionEngine: { evaluate }, goal: 'Read orders', pair: { ...pair, scalarSlots: [] },
      requirements: [{ id: 'source-http', connector: 'http', description: 'Orders', reason: 'Report request' }],
      httpConnections: [{ id: 'orders-api', label: 'Orders', basePath: '/', operations: [
        { operationId: 'mutating', method: 'POST', path: '/orders', sideEffect: 'NONE', summary: 'Create orders' },
      ] }], rdbTables: [], inspectSource: inspect,
      candidateRequests: [{ kind: 'http_operation', connectionId: 'orders-api', path: '/orders' }],
    });

    expect(result).toEqual([]);
    expect(evaluate).not.toHaveBeenCalled();
    expect(inspect).not.toHaveBeenCalled();
  });

  it('rechecks a newly proposed table with Jev, adds approved metadata, then accepts the plan', async () => {
    const decisionRequests: DecisionEvaluationRequest[] = [];
    const inspectedTables: string[] = [];
    const decisionEngine: DecisionEngine = { async evaluate(request) {
      decisionRequests.push(request);
      const choiceFor = (id: string): SourceChoice => {
        const candidate = (request.questions[id]!.instructions as { candidate?: { table?: string } }).candidate;
        if (request.questions[id]!.instructions.task.startsWith('Decide whether inspecting')) {
          if (decisionRequests.length === 1) return candidate?.table === 'warehouse.orders' ? 'use_source' : 'skip_source';
          return candidate?.table === 'warehouse.audit' ? 'use_source' : 'skip_source';
        }
        return 'skip_source';
      };
      return { answers: chosenQuestions(request, choiceFor) };
    } };
    const inspect = vi.fn(async (request: { table?: string }) => {
      inspectedTables.push(request.table!);
      return { table: request.table, columns: [{ name: 'created_at', type: 'date' }] };
    });
    const plan = capturePlanForTable('warehouse.audit');
    const modelRequests: InvestigationRunRequest<unknown>[] = [];
    const runner: InvestigationRunner = { providerName: 'test', async run<T>(request: InvestigationRunRequest<T>) {
      modelRequests.push(request);
      return { output: request.outputSchema.parse(plan) };
    } };

    await expect(new ReportPlanner(runner, { decisionEngine }).inferCapturePlan({
      goal: 'Summarize monthly orders', pair, httpConnections: [],
      rdbTables: ['warehouse.orders', 'warehouse.audit'], connectedConnectors: ['rdb'],
      requirements: [{ id: 'source-rdb', connector: 'rdb', description: 'Order records', reason: 'Report request' }],
      inspectSource: inspect,
    })).resolves.toMatchObject({ capturePlan: { rdb: [{ table: 'warehouse.audit' }] } });

    expect(decisionRequests).toHaveLength(2);
    expect(Object.keys(decisionRequests[0]!.questions)).toEqual(['source_0', 'source_1']);
    expect(Object.keys(decisionRequests[1]!.questions)).toEqual(['source_0']);
    expect((decisionRequests[1]!.questions.source_0!.instructions as { candidate: { table: string } }).candidate.table)
      .toBe('warehouse.audit');
    expect(inspectedTables).toEqual(['warehouse.orders', 'warehouse.audit']);
    expect(modelRequests).toHaveLength(2);
    expect(JSON.stringify(modelRequests[1]!.context.untrustedData)).toContain('warehouse.audit');
  });

  it('lets source discovery recover to an already Jev-approved table after Jev rejects an alternative', async () => {
    const decisionRequests: DecisionEvaluationRequest[] = [];
    const decisionEngine: DecisionEngine = { async evaluate(request) {
      decisionRequests.push(request);
      return { answers: chosenQuestions(request, id => {
        const candidate = (request.questions[id]!.instructions as { candidate?: { table?: string } }).candidate;
        if (decisionRequests.length === 1) return candidate?.table === 'warehouse.orders' ? 'use_source' : 'skip_source';
        return 'skip_source';
      }) };
    } };
    const inspect = vi.fn(async (request: { table?: string }) => ({ table: request.table }));
    const rejectedPlan = capturePlanForTable('warehouse.audit');
    const acceptedPlan = capturePlanForTable('warehouse.orders');
    const modelRequests: InvestigationRunRequest<unknown>[] = [];
    const runner: InvestigationRunner = { providerName: 'test', async run<T>(request: InvestigationRunRequest<T>) {
      modelRequests.push(request);
      return { output: request.outputSchema.parse(modelRequests.length === 1 ? rejectedPlan : acceptedPlan) };
    } };

    await expect(new ReportPlanner(runner, { decisionEngine }).inferCapturePlan({
      goal: 'Summarize monthly orders', pair, httpConnections: [],
      rdbTables: ['warehouse.orders', 'warehouse.audit'], connectedConnectors: ['rdb'],
      requirements: [{ id: 'source-rdb', connector: 'rdb', description: 'Order records', reason: 'Report request' }],
      inspectSource: inspect,
    })).resolves.toMatchObject({ capturePlan: { rdb: [{ table: 'warehouse.orders' }] } });

    expect(decisionRequests).toHaveLength(2);
    expect(inspect).toHaveBeenCalledTimes(1);
    expect(inspect).toHaveBeenCalledWith({ kind: 'rdb_table', table: 'warehouse.orders', limit: 20 }, expect.any(AbortSignal));
    expect(modelRequests).toHaveLength(2);
    expect(JSON.parse(modelRequests[1]!.context.untrustedData!).planFeedback)
      .toContainEqual({ validationError: 'report_source_candidate_not_selected' });
  });

  it('does not probe a denied HTTP candidate and can retry a Jev-approved connection', async () => {
    const decisionRequests: DecisionEvaluationRequest[] = [];
    const events: string[] = [];
    const decisionEngine: DecisionEngine = { async evaluate(request) {
      decisionRequests.push(request);
      const candidate = (request.questions.source_0!.instructions as { candidate: { connection: string } }).candidate;
      events.push(`jev:${candidate.connection}`);
      return { answers: chosenQuestions(request, () => candidate.connection === 'live' ? 'use_source' : 'skip_source') };
    } };
    const capturePlan = { schemaVersion: 1, status: 'planned', plan: {
      schemaVersion: 1,
      examplePeriod: { start: '2040-01-01', endInclusive: '2040-01-31', label: 'example' },
      targetPeriod: { start: '2040-02-01', endInclusive: '2040-02-29', label: 'target' },
      capturePlan: { schemaVersion: 1, http: [{ alias: 'orders', connectionId: 'live', path: '/orders', rowsPath: '$' }], rdb: [] },
      requirementBindings: [{ requirementId: 'source-http', aliases: ['orders'] }],
    } };
    const outputs = [
      { schemaVersion: 1, status: 'need_evidence', request: { kind: 'http_connection', connectionId: 'stale', path: '/orders' } },
      { schemaVersion: 1, status: 'need_evidence', request: { kind: 'http_connection', connectionId: 'live', path: '/orders' } },
      capturePlan,
    ];
    const modelRequests: InvestigationRunRequest<unknown>[] = [];
    const runner: InvestigationRunner = { providerName: 'test', async run<T>(request: InvestigationRunRequest<T>) {
      modelRequests.push(request);
      return { output: request.outputSchema.parse(outputs.shift()) };
    } };
    const inspect = vi.fn(async (request: { kind?: string; connectionId?: string; path?: string }) => {
      events.push(`probe:${request.connectionId}`);
      return { available: true, connectionId: request.connectionId, path: request.path, shape: { type: 'array' } };
    });

    await expect(new ReportPlanner(runner, { decisionEngine }).inferCapturePlan({
      goal: 'Read the orders endpoint', pair,
      httpConnections: [
        { id: 'stale', label: 'stale', basePath: '/' },
        { id: 'live', label: 'live', basePath: '/' },
      ], rdbTables: [], connectedConnectors: ['http'],
      requirements: [{ id: 'source-http', connector: 'http', description: 'Order records', reason: 'Report request' }],
      inspectSource: inspect,
    })).resolves.toMatchObject({ capturePlan: { http: [{ connectionId: 'live', path: '/orders' }] } });

    expect(decisionRequests).toHaveLength(2);
    expect(inspect).toHaveBeenCalledTimes(1);
    expect(inspect).toHaveBeenCalledWith({ kind: 'http_connection', connectionId: 'live', path: '/orders' }, expect.any(AbortSignal));
    expect(events).toEqual(['jev:stale', 'jev:live', 'probe:live']);
    expect(modelRequests).toHaveLength(3);
  });

  it('processes every Jev-selected DB candidate while bounding concurrent metadata connections', async () => {
    const decisionEngine: DecisionEngine = { async evaluate(request) {
      return { answers: chosenQuestions(request, () => 'use_source') };
    } };
    let active = 0;
    let maxActive = 0;
    const inspect = vi.fn(async (request: { table?: string }) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise(resolve => setTimeout(resolve, 2));
      active -= 1;
      return { table: request.table };
    });
    const tables = Array.from({ length: 9 }, (_, index) => `warehouse.table_${index}`);

    const result = await selectAndInspectReportSources({ decisionEngine, goal: 'Inspect warehouse',
      pair: { ...pair, scalarSlots: [] }, requirements: [
        { id: 'source-rdb', connector: 'rdb', description: 'Warehouse data', reason: 'Report request' },
      ], httpConnections: [], rdbTables: tables, inspectSource: inspect });

    expect(result).toHaveLength(tables.length);
    expect(result.map(item => (item.request as { table?: string }).table)).toEqual(tables);
    expect(inspect).toHaveBeenCalledTimes(tables.length);
    expect(maxActive).toBe(4);
  });

  it('waits for sibling DB metadata reads to settle before propagating a failed read', async () => {
    const failure = new Error('metadata read failed');
    const decisionEngine: DecisionEngine = { async evaluate(request) {
      return { answers: chosenQuestions(request, () => 'use_source') };
    } };
    let siblingSettled = false;
    const inspect = vi.fn(async (request: { table?: string }) => {
      if (request.table === 'warehouse.first') throw failure;
      await new Promise(resolve => setTimeout(resolve, 10));
      siblingSettled = true;
      return { table: request.table };
    });

    await expect(selectAndInspectReportSources({ decisionEngine, goal: 'Inspect warehouse',
      pair: { ...pair, scalarSlots: [] }, requirements: [
        { id: 'source-rdb', connector: 'rdb', description: 'Warehouse data', reason: 'Report request' },
      ], httpConnections: [], rdbTables: ['warehouse.first', 'warehouse.second'], inspectSource: inspect }))
      .rejects.toBe(failure);
    expect(inspect).toHaveBeenCalledTimes(2);
    expect(siblingSettled).toBe(true);
  });

  it('leaves uncertain candidate judgments to the existing paged discovery path', async () => {
    const inspect = vi.fn();
    const decisionEngine: DecisionEngine = { async evaluate(request) {
      return { answers: chosenQuestions(request, () => 'unclear') };
    } };

    await expect(selectAndInspectReportSources({ decisionEngine, goal: 'Inspect',
      pair: { ...pair, scalarSlots: [] }, requirements: [
        { id: 'source-rdb', connector: 'rdb', description: 'Warehouse data', reason: 'Report request' },
      ], httpConnections: [], rdbTables: ['warehouse.orders'], inspectSource: inspect })).resolves.toEqual([]);
    expect(inspect).not.toHaveBeenCalled();
  });
});
