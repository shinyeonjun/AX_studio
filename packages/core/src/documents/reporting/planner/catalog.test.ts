import { describe, expect, it, vi } from 'vitest';
import type { InvestigationRunner, InvestigationRunRequest } from '../../../intelligence/agent/investigation-runner.js';
import type { PdfReportPairAnalysis } from '../../read/types/pdf.js';
import type { OpenApiOperation } from '../../../connectors/protocols/openapi/parse.js';
import { ReportPlanner } from './planner.js';
import { inspectReportCatalog } from './catalog.js';
import { ReportSourceDecisionSchema, ReportSourceDecisionWireSchema } from './source-discovery.js';

const pair: PdfReportPairAnalysis = { schemaVersion: 1, pairId: 'p', templateHash: 't', exampleHash: 'e',
  pageCount: 1, pages: [], scalarSlots: [], tableGroups: [], templateImages: [], exampleImages: [] };
const stop = { schemaVersion: 1, status: 'needs_input', reason: 'Diagnostic complete' };
function plannerFor(outputs: unknown[]) {
  const seen: InvestigationRunRequest<unknown>[] = [];
  const runner: InvestigationRunner = { providerName: 'test', async run<T>(request: InvestigationRunRequest<T>) {
    seen.push(request);
    return { output: request.outputSchema.parse(outputs.shift()) };
  } };
  return { planner: new ReportPlanner(runner), seen };
}
const need = (request: unknown) => ({ schemaVersion: 1, status: 'need_evidence', request });
const input = { goal: 'Summarize the requested business data', pair, connectedConnectors: ['rdb', 'http'] };

describe('report source catalog disclosure', () => {
  it('starts with counts instead of injecting thousands of tables and operation schemas', async () => {
    const { planner, seen } = plannerFor([stop]);
    const operation: OpenApiOperation = { operationId: 'readings', method: 'GET', path: '/readings', sideEffect: 'NONE',
      responses: [{ status: '200', contentTypes: ['application/json'], fields: [{ name: 'private-schema-marker', description: 'x'.repeat(500) }] }] };
    await expect(planner.inferCapturePlan({ ...input,
      rdbTables: Array.from({ length: 20_000 }, (_, i) => `warehouse.table_${i}`),
      httpConnections: Array.from({ length: 200 }, (_, i) => ({ id: `api-${i}`, label: `API ${i}`, basePath: '/',
        operations: Array.from({ length: 20 }, (_, j) => ({ ...operation, operationId: `operation-${j}`, path: `/readings-${j}` })) })),
    })).rejects.toThrow('report_source_discovery_needs_input');
    const text = seen[0]!.context.untrustedData!;
    expect(text.length).toBeLessThan(2_000);
    expect(JSON.parse(text).sourceCatalog).toMatchObject({ httpConnections: 200, httpOperations: 4_000, rdbTables: 20_000 });
    expect(text).not.toContain('private-schema-marker');
    expect(text).not.toContain('warehouse.table_');
  });

  it('makes late tables reachable by offset and query, then forwards schema-page coordinates', async () => {
    const { planner, seen } = plannerFor([
      need({ kind: 'catalog', connector: 'rdb', offset: 0, limit: 2 }),
      need({ kind: 'catalog', connector: 'rdb', offset: 2, limit: 2 }),
      need({ kind: 'catalog', connector: 'rdb', query: 'retention', offset: 0, limit: 2 }),
      need({ kind: 'rdb_table', table: 'archive.retention', offset: 200, limit: 2 }), stop, stop,
    ]);
    const inspect = vi.fn(async () => ({ columns: [{ name: 'late_column', type: 'numeric' }], nextOffset: 202 }));
    await expect(planner.inferCapturePlan({ ...input, httpConnections: [],
      rdbTables: ['public.alpha', 'public.beta', 'public.gamma', 'archive.retention'], inspectSource: inspect }))
      .rejects.toThrow('report_source_discovery_needs_input');
    const observations = seen.slice(1).map(request => JSON.parse(request.context.untrustedData!).inspectedEvidence.at(-1).result);
    expect(observations[0]).toMatchObject({ total: 4, nextOffset: 2, entries: [{ table: 'public.alpha' }, { table: 'public.beta' }] });
    expect(observations[1]).toMatchObject({ total: 4, entries: [{ table: 'public.gamma' }, { table: 'archive.retention' }] });
    expect(observations[2]).toMatchObject({ total: 1, entries: [{ table: 'archive.retention' }] });
    expect(inspect).toHaveBeenCalledExactlyOnceWith({ kind: 'rdb_table', table: 'archive.retention', offset: 200, limit: 2 }, expect.any(AbortSignal));
    expect(seen[0]!.context.untrustedData).not.toContain('late_column');
    expect(seen.at(-1)!.context.untrustedData).toContain('late_column');
  });

  it('discloses operation schemas only after selecting the configured connection and path', async () => {
    const { planner, seen } = plannerFor([
      need({ kind: 'catalog', connector: 'http', query: 'history', offset: 0, limit: 2 }),
      need({ kind: 'http_operation', connectionId: 'metrics', path: '/history' }), stop, stop,
    ]);
    const inspect = vi.fn();
    await expect(planner.inferCapturePlan({ ...input, rdbTables: [], inspectSource: inspect,
      httpConnections: [{ id: 'metrics', label: 'Metrics', basePath: '/', operations: [{
        operationId: 'history', method: 'GET', path: '/history', summary: 'Historical facts',
        parameters: [{ name: 'start', in: 'query', required: true, description: 'selected-schema-marker' }],
      }] }],
    })).rejects.toThrow('report_source_discovery_needs_input');
    expect(seen[1]!.context.untrustedData).not.toContain('selected-schema-marker');
    expect(seen[2]!.context.untrustedData).toContain('selected-schema-marker');
    expect(inspect).not.toHaveBeenCalled();
  });

  it('keeps paging fields in both domain and provider request contracts', () => {
    const value = need({ kind: 'rdb_table', table: 'archive.retention', offset: 200, limit: 2 });
    expect(ReportSourceDecisionWireSchema.parse(value).request).toEqual(value.request);
    expect(ReportSourceDecisionSchema.parse(value).request).toEqual(value.request);
  });

  it('can search schema descriptions and jump to a late HTTP candidate without exposing other schemas', async () => {
    const connections = Array.from({ length: 2_000 }, (_, index) => ({ id: `api-${index}`, label: `API ${index}`, basePath: '/',
      operations: [{ operationId: `read-${index}`, method: 'GET', path: `/read-${index}`, parameters: [{
        name: 'filter', in: 'query' as const, required: false, description: index === 1_999 ? 'Historical retention measurements' : 'Standard measurements',
      }] }] }));
    const last = inspectReportCatalog(connections, [], { kind: 'catalog', connector: 'http', offset: 3_999, limit: 1 });
    expect(last).toMatchObject({ total: 4_000, hasMore: false, complete: false,
      entries: [{ connectionId: 'api-1999', path: '/read-1999' }] });
    const { planner, seen } = plannerFor([
      need({ kind: 'catalog', query: 'HISTORICAL retention', limit: 2 }),
      need({ kind: 'http_operation', connectionId: 'api-1999', path: '/read-1999' }), stop, stop,
    ]);
    await expect(planner.inferCapturePlan({ ...input, httpConnections: connections, rdbTables: [] }))
      .rejects.toThrow('report_source_discovery_needs_input');
    const page = JSON.parse(seen[1]!.context.untrustedData!).inspectedEvidence[0].result;
    expect(page).toMatchObject({ total: 1, complete: true, entries: [{ connectionId: 'api-1999', path: '/read-1999' }] });
    expect(seen[1]!.context.untrustedData).not.toContain('Historical retention measurements');
    expect(seen[2]!.context.untrustedData).toContain('Historical retention measurements');
    expect(seen[2]!.context.untrustedData).not.toContain('Standard measurements');
  });

  it('pages by the response budget without losing entries beyond the first page', () => {
    const connections = Array.from({ length: 20 }, (_, index) => ({ id: `api-${index}`, label: 'API', basePath: `/${'a'.repeat(2_000)}` }));
    const first = inspectReportCatalog(connections, [], { kind: 'catalog', limit: 20 });
    expect(first).toHaveProperty('hasMore', true);
    if (!first.entries) throw new Error('Expected a catalog page');
    expect(JSON.stringify(first).length).toBeLessThan(24_000);
    const ids = first.entries.map(entry => entry.connectionId);
    let nextOffset = first.nextOffset;
    while (nextOffset !== null) {
      const page = inspectReportCatalog(connections, [], { kind: 'catalog', offset: nextOffset, limit: 20 });
      if (!page.entries) throw new Error('Expected a catalog page');
      ids.push(...page.entries.map(entry => entry.connectionId));
      nextOffset = page.nextOffset;
    }
    expect(ids).toEqual(connections.map(connection => connection.id));
  });

  it('does not send unrelated connection and operation metadata into Jev refinement', async () => {
    const capture = { schemaVersion: 1 as const, examplePeriod: { start: '2040-01-01', endInclusive: '2040-01-31', label: 'example' },
      targetPeriod: { start: '2040-02-01', endInclusive: '2040-02-29', label: 'target' },
      capturePlan: { schemaVersion: 1 as const, http: [{ alias: 'facts', connectionId: 'selected', path: '/facts?active=true', rowsPath: '$' }], rdb: [] } };
    const { planner, seen } = plannerFor([capture]);
    const decisionStates: unknown[] = [];
    planner.setDecisionEngine({ async evaluate(request) {
      decisionStates.push(request.state);
      const answers: Record<string, { type: 'choice'; choice: string; confidence: number; probabilities: Record<string, number> }> = {};
      for (const [id, question] of Object.entries(request.questions)) {
        if (question.type !== 'choice') throw new Error('Expected a choice question');
        const choice = Object.keys(question.criteria)[0]!;
        answers[id] = { type: 'choice', choice, confidence: 0.99, probabilities: { [choice]: 0.99 } };
      }
      return { answers };
    } });
    const operation = { operationId: 'selected', method: 'GET', path: '/facts', sideEffect: 'NONE' as const, summary: 'Selected schema' };
    await expect(planner.refineCapturePlan({ ...input, rdbTables: [], provisional: capture, httpProbes: [{
      alias: 'facts', path: '/facts?active=true', status: 200,
      shape: { type: 'object', fields: {
        records: { type: 'array', length: 2, item: { type: 'object', fields: { id: { type: 'number' } } } },
        archive: { type: 'array', length: 1, item: { type: 'object', fields: { id: { type: 'number' } } } },
      } },
    }], httpConnections: [
      { id: 'selected', label: 'Selected', basePath: '/', operations: [operation,
        { operationId: 'not-selected', method: 'GET', path: '/other', summary: 'Unselected schema' }] },
      { id: 'unrelated', label: 'Unrelated', basePath: '/', operations: [operation] },
    ] })).resolves.toMatchObject({ capturePlan: { http: [{ alias: 'facts', rowsPath: 'records' }] } });
    expect(decisionStates).toHaveLength(1);
    const state = JSON.stringify(decisionStates[0]);
    expect(state).not.toContain('selected');
    expect(state).not.toContain('Unselected schema');
    expect(state).not.toContain('unrelated');
    expect(state).not.toContain('/other');
    expect(seen).toEqual([]);
  });

  it.each([
    { kind: 'catalog', offset: -1 }, { kind: 'catalog', limit: 21 },
    { kind: 'rdb_table', table: 'facts', offset: 1_000_001 }, { kind: 'rdb_table', table: 'facts', limit: 201 },
    { kind: 'http_operation', connectionId: 'api', path: 'https://other.test/facts' },
  ])('rejects invalid metadata page requests: %j', request => {
    expect(ReportSourceDecisionSchema.safeParse(need(request)).success).toBe(false);
  });
});
