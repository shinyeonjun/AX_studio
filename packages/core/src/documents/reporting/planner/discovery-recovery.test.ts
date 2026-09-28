import { describe, expect, it, vi } from 'vitest';
import type { InvestigationRunner, InvestigationRunRequest } from '../../../intelligence/agent/investigation-runner.js';
import { inspectReportCatalog } from './catalog.js';
import { REPORT_SOURCE_DISCOVERY_TIMEOUT_MS, discoverReportSources } from './source-discovery.js';
import { ReportPlanner } from './planner.js';

const context = { skillGoal: 'Find authorized data', taskGoal: 'Use the connected data', evidence: [],
  connectedConnectors: ['rdb'], untrustedData: '{}' };
const complete = { schemaVersion: 1, status: 'planned', plan: { schemaVersion: 1,
  examplePeriod: { start: '2042-01-01', endInclusive: '2042-01-31', label: 'past' },
  targetPeriod: { start: '2042-02-01', endInclusive: '2042-02-28', label: 'next' },
  capturePlan: { schemaVersion: 1, http: [], rdb: [{ alias: 'facts', table: 'warehouse.facts' }] },
  requirementBindings: [] } };

describe('discovery recovery through the production interface', () => {
  it('recovers when the provider rejects structured output before returning a decision', async () => {
    let calls = 0;
    const runner: InvestigationRunner = { providerName: 'test', async run<T>(request: InvestigationRunRequest<T>) {
      calls += 1;
      if (calls === 1) throw Object.assign(new Error('invalid provider response'), {
        code: 'model_output_invalid',
        issues: [{ code: 'invalid_type', path: ['plan', 'capturePlan', 'http', 0, 'pagination', 'pageSize'],
          message: 'Rejected private source value', received: 'private-value' }],
      });
      expect(JSON.parse(request.context.untrustedData!).decisionFeedback[0].validationIssues).toEqual([
        { code: 'invalid_type', path: ['plan', 'capturePlan', 'http', 0, 'pagination', 'pageSize'] },
      ]);
      expect(request.context.untrustedData).not.toContain('private-value');
      return { output: request.outputSchema.parse(complete) };
    } };
    await expect(discoverReportSources({ runner, context, user: '보고해줘', images: [], requirements: [],
      validate: value => value })).resolves.toEqual(complete.plan);
    expect(calls).toBe(2);
  });
  it('corrects an unknown table selection without executing the rejected plan', async () => {
    let calls = 0;
    const runner: InvestigationRunner = { providerName: 'test', async run<T>(request: InvestigationRunRequest<T>) {
      calls += 1;
      if (calls === 1) return { output: request.outputSchema.parse({ ...complete,
        plan: { ...complete.plan, capturePlan: { ...complete.plan.capturePlan,
          rdb: [{ alias: 'facts', table: 'invented' }] } } }) };
      expect(JSON.parse(request.context.untrustedData!).planFeedback).toEqual([
        { validationError: 'report_rdb_table_unknown' },
      ]);
      return { output: request.outputSchema.parse(complete) };
    } };
    const planner = new ReportPlanner(runner);
    await expect(planner.inferCapturePlan({ goal: '같은 기준으로 보고해줘',
      connectedConnectors: ['rdb'], httpConnections: [], rdbTables: ['warehouse.facts'],
      pair: { schemaVersion: 1, pairId: 'p', templateHash: 't', exampleHash: 'e', pageCount: 1,
        pages: [], scalarSlots: [], tableGroups: [], templateImages: [], exampleImages: [] },
    })).resolves.toMatchObject({ capturePlan: complete.plan.capturePlan });
    expect(calls).toBe(2);
  });
  it('identifies the extra field so a real wire-shape mistake can be corrected without loosening validation', async () => {
    const requests: InvestigationRunRequest<unknown>[] = [];
    const runner: InvestigationRunner = { providerName: 'test', async run<T>(request: InvestigationRunRequest<T>) {
      requests.push(request);
      if (requests.length === 1) return { output: request.outputSchema.parse({ schemaVersion: 1,
        status: 'need_evidence', request: { kind: 'rdb_table', table: 'warehouse.facts', connector: 'rdb' } }) };
      const feedback = JSON.parse(request.context.untrustedData!).decisionFeedback;
      expect(feedback[0].validationIssues[0]).toMatchObject({ code: 'unrecognized_keys', path: ['request'], keys: ['connector'] });
      return { output: request.outputSchema.parse(complete) };
    } };
    const inspect = vi.fn();
    await expect(discoverReportSources({ runner, context, user: '같은 기준으로', images: [], requirements: [],
      inspect, validate: value => value })).resolves.toEqual(complete.plan);
    expect(inspect).not.toHaveBeenCalled();
  });
  it.each([24, 25])('keeps a hard inspection budget while permitting the final decision (%s reads)', async count => {
    let calls = 0;
    const runner: InvestigationRunner = { providerName: 'test', async run<T>(request: InvestigationRunRequest<T>) {
      const n = calls++;
      return { output: request.outputSchema.parse(n < count ? { schemaVersion: 1, status: 'need_evidence',
        request: { kind: 'catalog', connector: 'rdb', offset: n * 2, limit: 2 } } : complete) };
    } };
    const inspect = vi.fn(async () => ({ entries: [], hasMore: true }));
    const outcome = discoverReportSources({ runner, context, user: '정리해줘', images: [], requirements: [], inspect, validate: value => value });
    if (count === 24) await expect(outcome).resolves.toEqual(complete.plan);
    else await expect(outcome).rejects.toThrow('report_source_discovery_round_limit');
    expect(inspect).toHaveBeenCalledTimes(24);
  });

  it('does not broaden the selected connection scope while recovering an empty search', () => {
    const result = inspectReportCatalog([{ id: 'chosen', label: 'A', basePath: '/' },
      { id: 'other', label: 'B', basePath: '/' }], ['private.records'],
    { kind: 'catalog', connector: 'http', connectionId: 'chosen', query: 'unmatched' });
    expect(result).toMatchObject({ recovery: { page: { total: 1, entries: [{ connectionId: 'chosen' }] } } });
    expect(JSON.stringify(result)).not.toContain('other');
    expect(JSON.stringify(result)).not.toContain('private.records');
  });
  it.each(['지난번처럼 정리해줘', 'revenue', '지원 이력'])('offers bounded browsing when %s does not match opaque labels', query => {
    const connections = Array.from({ length: 50 }, (_, i) => ({ id: `connection-${i}`, label: `연결 ${i}`, basePath: '/' }));
    const result = inspectReportCatalog(connections, [], { kind: 'catalog', connector: 'http', query, limit: 2 });
    expect(result).toMatchObject({ total: 0, entries: [], recovery: { reason: 'no_metadata_match',
      request: { kind: 'catalog', connector: 'http', offset: 0, limit: 2 },
      page: { total: 50, entries: [{ connectionId: 'connection-0' }, { connectionId: 'connection-1' }], nextOffset: 2 } } });
    expect(JSON.stringify(result).length).toBeLessThan(2000);
    expect(result).not.toHaveProperty('selectedConnectionId');
  });

  it('allows productive schema paging followed by a final decision, rather than failing after six reads', async () => {
    const requests: InvestigationRunRequest<unknown>[] = [];
    const runner: InvestigationRunner = { providerName: 'test', async run<T>(request: InvestigationRunRequest<T>) {
      requests.push(request);
      const n = requests.length;
      return { output: request.outputSchema.parse(n <= 8 ? { schemaVersion: 1, status: 'need_evidence',
        request: { kind: 'rdb_table', table: 'warehouse.facts', offset: (n - 1) * 2, limit: 2 } } : complete) };
    } };
    const inspect = vi.fn(async () => ({ columns: [], complete: false }));
    await expect(discoverReportSources({ runner, context, user: '앞으로 이 기준으로 해줘', images: [],
      requirements: [], inspect, validate: value => value })).resolves.toEqual(complete.plan);
    expect(inspect).toHaveBeenCalledTimes(8);
    expect(requests).toHaveLength(9);
  });

  it('does not checkpoint a model result arriving after the source-discovery deadline', async () => {
    vi.useFakeTimers();
    try {
      let release!: () => void;
      const saved: string[] = [];
      const runner: InvestigationRunner = { providerName: 'test', async run<T>(request: InvestigationRunRequest<T>) {
        return new Promise<{ output: T }>(resolve => { release = () => resolve({ output: request.outputSchema.parse(complete) }); });
      } };
      const planner = new ReportPlanner(runner).forExecution(async (name, _input, run) => {
        const result = await run(); saved.push(name); return result;
      });
      const outcome = planner.inferCapturePlan({ goal: '보고해줘', connectedConnectors: ['rdb'], httpConnections: [],
        rdbTables: ['warehouse.facts'], pair: { schemaVersion: 1, pairId: 'p', templateHash: 't', exampleHash: 'e',
          pageCount: 1, pages: [], scalarSlots: [], tableGroups: [], templateImages: [], exampleImages: [] } }).catch(error => error);
      await vi.advanceTimersByTimeAsync(REPORT_SOURCE_DISCOVERY_TIMEOUT_MS + 1);
      expect(await outcome).toMatchObject({ message: 'report_source_discovery_deadline' });
      release(); await vi.advanceTimersByTimeAsync(0);
      expect(saved).toEqual([]);
      expect(vi.getTimerCount()).toBe(0);
    } finally { vi.useRealTimers(); }
  });
});
