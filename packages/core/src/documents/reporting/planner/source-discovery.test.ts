import { describe, expect, it, vi } from 'vitest';
import type { InvestigationRunner, InvestigationRunRequest } from '../../../intelligence/agent/investigation-runner.js';
import { zodToCodexJsonSchema } from '../../../intelligence/agent/model/cli-json.js';
import { REPORT_SOURCE_DISCOVERY_TIMEOUT_MS, ReportSourceDecisionSchema, ReportSourceDecisionWireSchema, discoverReportSources, type ReportSourceInspection } from './source-discovery.js';

const plan = {
  schemaVersion: 1,
  examplePeriod: { start: '2040-01-01', endInclusive: '2040-01-31', label: 'example' },
  targetPeriod: { start: '2040-02-01', endInclusive: '2040-02-29', label: 'target' },
  capturePlan: { schemaVersion: 1, http: [], rdb: [] },
};

describe('source discovery response contract', () => {
  function runnerFor(outputs: unknown[], seen: InvestigationRunRequest<unknown>[]): InvestigationRunner {
    return { providerName: 'test', async run<T>(request: InvestigationRunRequest<T>) {
      seen.push(request);
      return { output: request.outputSchema.parse(outputs.shift()) };
    } };
  }
  const context = { skillGoal: 'Discover sources', taskGoal: 'Report', evidence: [], connectedConnectors: ['rdb'], untrustedData: '{}' };
  it.each(['runner', 'inspection'])('enforces the total deadline while %s never settles', async mode => {
    vi.useFakeTimers();
    try {
      let failure: unknown;
      let settled = false;
      const runner: InvestigationRunner = { providerName: 'test', async run<T>(request: InvestigationRunRequest<T>) {
        if (mode === 'runner') return new Promise(() => {});
        return { output: request.outputSchema.parse({ schemaVersion: 1, status: 'need_evidence',
          request: { kind: 'rdb_table', table: 'records' } }) };
      } };
      const result = discoverReportSources({ runner, context, user: 'Report', images: [], requirements: [],
        inspect: () => new Promise(() => {}), validate: value => value }).then(
          () => { settled = true; }, error => { failure = error; settled = true; });
      await vi.advanceTimersByTimeAsync(180_001);
      expect(settled).toBe(false);
      await vi.advanceTimersByTimeAsync(REPORT_SOURCE_DISCOVERY_TIMEOUT_MS - 180_000 + 1);
      expect(failure).toMatchObject({ message: 'report_source_discovery_deadline' });
      await result;
      expect(vi.getTimerCount()).toBe(0);
    } finally { vi.useRealTimers(); }
  });
  it('returns specific coverage feedback and rejects repetition before any capture', async () => {
    const partial = { ...plan, capturePlan: { schemaVersion: 1, http: [], rdb: [{ alias: 'dimension', table: 'dimension' }] }, requirementBindings: [] };
    const decision = { schemaVersion: 1, status: 'planned', plan: partial };
    const seen: InvestigationRunRequest<unknown>[] = [];
    await expect(discoverReportSources({ runner: runnerFor([decision, decision], seen), context,
      user: 'Report', images: [], validate: value => value,
      requirements: [{ id: 'event-stream', connector: 'http', description: 'Events', reason: 'Requested' }] }))
      .rejects.toThrow('report_source_discovery_no_progress');
    expect(JSON.parse(seen[1]!.context.untrustedData!).planFeedback)
      .toEqual([{ missingRequirementIds: ['event-stream'] }]);
  });
  it('passes inspection evidence back before accepting a fully bound plan', async () => {
    const seen: InvestigationRunRequest<unknown>[] = [];
    const complete = { ...plan, capturePlan: { schemaVersion: 1, http: [], rdb: [{ alias: 'records', table: 'archive.records' }] },
      requirementBindings: [{ requirementId: 'history', aliases: ['records'] }] };
    const inspect = vi.fn(async () => ({ columns: [{ name: 'amount', type: 'numeric' }] }));
    const result = await discoverReportSources({ runner: runnerFor([
      { schemaVersion: 1, status: 'need_evidence', request: { kind: 'rdb_table', table: 'archive.records' } },
      { schemaVersion: 1, status: 'planned', plan: complete },
    ], seen), context, user: 'Report', images: [], inspect, validate: value => value,
      requirements: [{ id: 'history', connector: 'rdb', description: 'History', reason: 'User requested history' }] });
    expect(result).toEqual(complete);
    expect(inspect).toHaveBeenCalledTimes(1);
    expect(seen[1]!.context.untrustedData).toContain('numeric');
    expect(seen[0]!.context.untrustedData).not.toContain('numeric');
    expect(zodToCodexJsonSchema(ReportSourceDecisionSchema)).toMatchObject({ type: 'object' });
  });
  it('retries a semantically invalid wire decision before inspecting or executing a source', async () => {
    const complete = { ...plan,
      capturePlan: { schemaVersion: 1, http: [], rdb: [{ alias: 'records', table: 'archive.records' }] },
      requirementBindings: [],
    };
    const invalid = { schemaVersion: 1, status: 'need_evidence',
      reason: 'The source shape needs confirmation.' };
    const seen: InvestigationRunRequest<unknown>[] = [];
    let calls = 0;
    const runner: InvestigationRunner = { providerName: 'test', async run<T>(request: InvestigationRunRequest<T>) {
      seen.push(request);
      calls++;
      return { output: (calls === 1 ? invalid : { schemaVersion: 1, status: 'planned', plan: complete }) as T };
    } };
    const inspect = vi.fn();
    await expect(discoverReportSources({ runner, context, user: 'Report', images: [], inspect,
      requirements: [], validate: value => value })).resolves.toEqual(complete);
    expect(inspect).not.toHaveBeenCalled();
    expect(JSON.parse(seen[1]!.context.untrustedData!).decisionFeedback).toMatchObject([
      { status: 'need_evidence', providedFields: ['reason'] },
    ]);
  });
  it('retries one transient agent timeout without repeating source inspection', async () => {
    const complete = { ...plan,
      capturePlan: { schemaVersion: 1, http: [], rdb: [{ alias: 'records', table: 'archive.records' }] },
      requirementBindings: [{ requirementId: 'history', aliases: ['records'] }],
    };
    const seen: InvestigationRunRequest<unknown>[] = [];
    let calls = 0;
    const runner: InvestigationRunner = { providerName: 'test', async run<T>(request: InvestigationRunRequest<T>) {
      seen.push(request);
      calls += 1;
      if (calls === 1) return { output: request.outputSchema.parse({ schemaVersion: 1, status: 'need_evidence',
        request: { kind: 'rdb_table', table: 'archive.records' } }) };
      if (calls === 2) throw Object.assign(new Error('Agent timed out'), { code: 'agent_timeout' });
      return { output: request.outputSchema.parse({ schemaVersion: 1, status: 'planned', plan: complete }) };
    } };
    const inspect = vi.fn(async () => ({ columns: [{ name: 'amount', type: 'numeric' }] }));

    await expect(discoverReportSources({ runner, context, user: 'Report', images: [], inspect,
      requirements: [{ id: 'history', connector: 'rdb', description: 'History', reason: 'Report input' }],
      validate: value => value })).resolves.toEqual(complete);
    expect(calls).toBe(3);
    expect(inspect).toHaveBeenCalledTimes(1);
    expect(JSON.parse(seen[2]!.context.untrustedData!).planFeedback).toContainEqual({
      validationError: 'report_source_agent_timeout_recheck',
    });
  });
  it('fails closed after one source-decision correction attempt', async () => {
    const invalid = { schemaVersion: 1, status: 'need_evidence', reason: 'Needs more detail.' };
    const seen: InvestigationRunRequest<unknown>[] = [];
    const inspect = vi.fn();
    await expect(discoverReportSources({ runner: runnerFor([invalid,
      { schemaVersion: 1, status: 'planned', reason: 'Still invalid.' }], seen), context,
      user: 'Report', images: [], inspect, requirements: [], validate: value => value }))
      .rejects.toMatchObject({ code: 'model_output_invalid' });
    expect(seen).toHaveLength(2);
    expect(inspect).not.toHaveBeenCalled();
  });
  it('stops repeated inspection without executing it twice', async () => {
    const request = { schemaVersion: 1, status: 'need_evidence', request: {
      kind: 'http_connection', connectionId: 'api', path: '/api/v1/orders',
    } };
    const inspect = vi.fn(async () => ({ available: false }));
    await expect(discoverReportSources({ runner: runnerFor([request, request], []), context,
      user: 'Report', images: [], requirements: [], inspect, validate: value => value }))
      .rejects.toThrow('report_source_discovery_no_progress');
    expect(inspect).toHaveBeenCalledTimes(1);
  });
  it('moves to another listed connection after a bounded route inspection failure', async () => {
    const staleRequest = {
      kind: 'http_connection', connectionId: 'stale', path: '/api/v1/orders',
    } as const;
    const liveRequest = {
      kind: 'http_connection', connectionId: 'live', path: '/api/v1/orders',
    } as const;
    const complete = {
      ...plan,
      capturePlan: { schemaVersion: 1, http: [{
        alias: 'orders', connectionId: 'live', path: '/api/v1/orders', rowsPath: 'data',
      }], rdb: [] },
      requirementBindings: [{ requirementId: 'orders', aliases: ['orders'] }],
    };
    const seen: InvestigationRunRequest<unknown>[] = [];
    const inspect = vi.fn(async (request: ReportSourceInspection) => {
      if (request.kind !== 'http_connection') throw new Error('Expected HTTP inspection');
      return request.connectionId === 'stale'
        ? { available: false, connectionId: request.connectionId, path: request.path, reason: 'http_probe_failed' }
        : { available: true, connectionId: request.connectionId, path: request.path, shape: { type: 'object' } };
    });
    const result = await discoverReportSources({
      runner: runnerFor([
        { schemaVersion: 1, status: 'need_evidence', request: staleRequest },
        { schemaVersion: 1, status: 'need_evidence', request: liveRequest },
        { schemaVersion: 1, status: 'planned', plan: complete },
      ], seen),
      context: { ...context, connectedConnectors: ['http'] }, user: 'Report', images: [],
      requirements: [{ id: 'orders', connector: 'http', description: 'Orders', reason: 'Report input' }],
      inspect, validate: value => value,
    });
    expect(result).toEqual(complete);
    expect(inspect).toHaveBeenNthCalledWith(1, staleRequest, expect.any(AbortSignal));
    expect(inspect).toHaveBeenNthCalledWith(2, liveRequest, expect.any(AbortSignal));
    expect(JSON.parse(seen[1]!.context.untrustedData!).inspectedEvidence).toEqual([
      { request: staleRequest, result: { available: false, connectionId: 'stale', path: '/api/v1/orders', reason: 'http_probe_failed' } },
    ]);
  });
  it('turns one repeated successful inspection into bounded planning feedback without executing it twice', async () => {
    const request = { kind: 'http_connection', connectionId: 'live', path: '/api/v1/orders' } as const;
    const complete = {
      ...plan,
      capturePlan: { schemaVersion: 1, http: [{ alias: 'orders', connectionId: 'live', path: '/api/v1/orders', rowsPath: '$' }], rdb: [] },
      requirementBindings: [{ requirementId: 'orders', aliases: ['orders'] }],
    };
    const seen: InvestigationRunRequest<unknown>[] = [];
    const inspect = vi.fn(async () => ({ available: true, connectionId: 'live', path: request.path,
      shape: { type: 'object' } }));
    const result = await discoverReportSources({ runner: runnerFor([
      { schemaVersion: 1, status: 'need_evidence', request },
      { schemaVersion: 1, status: 'need_evidence', request },
      { schemaVersion: 1, status: 'planned', plan: complete },
    ], seen), context, user: 'Report', images: [], inspect, requirements: [
      { id: 'orders', connector: 'http', description: 'Orders', reason: 'Report input' },
    ], validate: value => value });
    expect(result).toEqual(complete);
    expect(inspect).toHaveBeenCalledTimes(1);
    expect(JSON.parse(seen[2]!.context.untrustedData!).planFeedback).toContainEqual({
      validationError: 'report_source_inspection_already_completed',
    });
  });
  it.each(['needs_input', 'unsupported'])('stops %s without executing inspection or capture', async status => {
    const inspect = vi.fn();
    const validate = vi.fn();
    await expect(discoverReportSources({ runner: runnerFor([{ schemaVersion: 1, status, reason: 'Not documented' }], []),
      context, user: 'Report', images: [], requirements: [], inspect, validate }))
      .rejects.toThrow(`report_source_discovery_${status}`);
    expect(inspect).not.toHaveBeenCalled();
    expect(validate).not.toHaveBeenCalled();
  });
  it('rechecks one needs_input decision against the evidence already collected', async () => {
    const complete = {
      ...plan,
      capturePlan: { schemaVersion: 1, http: [{ alias: 'orders', connectionId: 'api', path: '/orders', rowsPath: '$' }], rdb: [] },
      requirementBindings: [{ requirementId: 'orders', aliases: ['orders'] }],
    };
    const seen: InvestigationRunRequest<unknown>[] = [];
    const result = await discoverReportSources({
      runner: runnerFor([
        { schemaVersion: 1, status: 'need_evidence', request: { kind: 'http_connection', connectionId: 'api', path: '/orders' } },
        { schemaVersion: 1, status: 'needs_input', reason: 'The response shape needs another look.' },
        { schemaVersion: 1, status: 'planned', plan: complete },
      ], seen),
      context: { ...context, connectedConnectors: ['http'] }, user: 'Report', images: [],
      requirements: [{ id: 'orders', connector: 'http', description: 'Orders', reason: 'Report input' }],
      inspect: async () => ({ available: true, shape: { type: 'array', length: 1 } }),
      validate: value => value,
    });
    expect(result).toEqual(complete);
    expect(JSON.parse(seen[2]!.context.untrustedData!).planFeedback).toContainEqual({
      validationError: 'report_source_needs_input_recheck',
    });
  });
  it('rejects the observed empty successful plan and omitted bindings', () => {
    expect(ReportSourceDecisionSchema.safeParse({ schemaVersion: 1, status: 'planned', plan }).success).toBe(false);
    expect(ReportSourceDecisionSchema.safeParse({ schemaVersion: 1, status: 'planned',
      plan: { ...plan, requirementBindings: [] } }).success).toBe(false);
  });
  it('allows missing information without forcing a guessed plan', () => {
    for (const status of ['needs_input', 'unsupported']) {
      expect(ReportSourceDecisionSchema.safeParse({ schemaVersion: 1, status,
        reason: 'The catalog does not document the required operation.' }).success).toBe(true);
    }
  });
  it('does not allow an executable plan alongside an evidence request', () => {
    expect(ReportSourceDecisionSchema.safeParse({ schemaVersion: 1, status: 'need_evidence',
      request: { kind: 'rdb_table', table: 'public.entries' }, plan }).success).toBe(false);
  });
  it('keeps source inspection requests as objects in the Codex wire schema', () => {
    const wire = zodToCodexJsonSchema(ReportSourceDecisionWireSchema);
    const request = (wire.properties as Record<string, Record<string, unknown>>).request;
    expect(JSON.stringify(request)).toContain('"type":"object"');
    expect(JSON.stringify(request)).not.toContain('JSON value encoded as a string');
  });
  it('accepts a redundant matching HTTP connector while rejecting a contradictory one', () => {
    const base = { schemaVersion: 1, status: 'need_evidence', request: {
      kind: 'http_connection', connectionId: 'api', path: '/orders',
    } };
    const matching = ReportSourceDecisionWireSchema.safeParse({
      ...base, request: { ...base.request, connector: 'http' },
    });
    expect(matching.success).toBe(true);
    expect(matching.success && ReportSourceDecisionSchema.safeParse(matching.data).success).toBe(true);
    const contradictory = ReportSourceDecisionWireSchema.safeParse({
      ...base, request: { ...base.request, connector: 'rdb' },
    });
    expect(contradictory.success).toBe(true);
    expect(contradictory.success && ReportSourceDecisionSchema.safeParse(contradictory.data).success).toBe(false);
  });
});
