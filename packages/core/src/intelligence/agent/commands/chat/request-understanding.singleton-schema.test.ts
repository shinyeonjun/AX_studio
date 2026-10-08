import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createDatabaseAsync } from '../../../../persistence/db.js';
import { WorkflowStore } from '../../../../persistence/workflow-store.js';
import type { MetadataCatalog, RequestUnderstandingResult } from '../../../../contracts/request-understanding.js';
import type { AxCommandResult } from '../schema.js';
import { JevDecisionEngine, JevDecisionError } from '../../../decision/jev.js';
import { RequestUnderstandingSession, RequestUnderstandingInvalidatedError, claimMetadataDispatchPermit } from '../../../decision/request-understanding/session.js';
import { AxCommandService } from '../service.js';
import { snapshotRegisteredHttpMetadata } from '../service/registered-http-metadata.js';
import { runRequestUnderstandingChat } from './request-understanding.js';
import { singletonSchemaFixture as frozen } from './request-understanding.singleton-schema.fixture.js';

vi.mock('../../../../persistence/paths/app-log.js', () => ({ appendAppLog: vi.fn() }));
const selected = (choice: string, probabilities = { [choice]: 1 }) => ({ type: 'choice', choice, probabilities });
interface WireRequest { questions: Record<string, unknown>; state: { phase: string } }
interface Options {
  flag?: boolean; text?: string; missingDictionary?: boolean; localAdapter?: boolean; hostCurrent?: boolean;
  initial?: Record<string, unknown>; operationBody?: unknown; operationStatus?: number; transportFailure?: boolean;
  changeCatalog?: (catalog: MetadataCatalog) => void;
  beforeOperationReply?: (session: RequestUnderstandingSession, store: WorkflowStore) => void | Promise<void>;
  corruptResult?: (result: AxCommandResult) => AxCommandResult;
}
const resources: Array<() => void> = [];
const observations: Array<Record<string, unknown>> = [];
afterEach(() => { for (const close of resources.splice(0)) close(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
afterAll(() => {
  if (!process.env.AX_SINGLETON_SCHEMA_EVIDENCE_DIR) return;
  const root = resolve(process.env.AX_SINGLETON_SCHEMA_EVIDENCE_DIR);
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, 'core-schema-observations.json'), JSON.stringify({ fixtureKind: 'synthetic_scripted_offline_integration',
    liveProviderCalls: 0, episodes: observations.length, completions: observations.filter(row => row.taskCompleted).length,
    noncompletions: observations.filter(row => !row.taskCompleted).length, observations }, null, 2));
});

async function fixture(options: Options = {}) {
  const db = await createDatabaseAsync(':memory:');
  resources.push(() => db.close?.());
  const store = new WorkflowStore(db);
  store.setConnection('http', true, { endpoints: [{ id: 'orders', label: frozen.label,
    baseUrl: 'https://synthetic.invalid', authType: 'none', discoveredReadOperations: [{ path: 'orders', label: 'Orders' }] }] });
  if (!options.missingDictionary) store.upsertDiscoveryMetadata({ assetId: frozen.sourceId, aliases: [], fields: frozen.fields.map(field => ({ ...field })) });
  const snapshot = snapshotRegisteredHttpMetadata(store, { catalogRevision: 1, policyRevision: 1 });
  options.changeCatalog?.(snapshot.catalog);
  const session = new RequestUnderstandingSession({ text: options.text ?? frozen.paraphrases[0].text,
    requestId: 'schema-request', workspaceSessionId: 'schema-session', catalog: snapshot.catalog,
    ...(options.localAdapter === false ? {} : { metadataAdapter: snapshot.adapter }),
    ...(options.hostCurrent === false ? {} : { assertHostCurrent: () => {
      if (store.getConnectionRevision() !== snapshot.adapter.connectionRevision
        || store.getDiscoveryMetadataRevision() !== snapshot.adapter.discoveryMetadataRevision) throw new RequestUnderstandingInvalidatedError('superseded');
    } }) });
  const forbidden = vi.fn(async () => { throw new Error('Forbidden offline connector/body/queue/network call'); });
  vi.stubGlobal('fetch', forbidden);
  const service = new AxCommandService(store, { readGateway: { execute: forbidden }, enqueueOnce: forbidden, resolveConnectionConfig: forbidden });
  const actualExecute = service.execute.bind(service);
  const execute = vi.spyOn(service, 'execute').mockImplementation(async (...args) => {
    const result = await actualExecute(...args);
    return options.corruptResult ? options.corruptResult(result) : result;
  });
  const requests: WireRequest[] = [];
  let requestBytes = 0;
  const fetchImpl: typeof fetch = vi.fn(async (url, init) => {
    expect(String(url)).toBe('https://offline.invalid/v1/systemone');
    const request = JSON.parse(String(init?.body)) as WireRequest;
    requests.push(request);
    requestBytes += Buffer.byteLength(String(init?.body), 'utf8');
    if (request.questions.intent) return Response.json({ answers: {
      intent: selected('schema'), targetSourceRef: selected('source_0'), outputKind: selected('not_stated'), ...options.initial,
    } });
    await options.beforeOperationReply?.(session, store);
    if (options.transportFailure) throw new Error('synthetic transport failure');
    return Response.json(options.operationBody ?? { answers: {} }, { status: options.operationStatus ?? 200 });
  });
  const engine = new JevDecisionEngine({ apiKey: 'offline-test', baseURL: 'https://offline.invalid', fetch: fetchImpl });
  const outcomes: RequestUnderstandingResult[] = [];
  const publications: AxCommandResult[] = [];
  const signal = new AbortController();
  const run = async () => {
    const began = performance.now();
    let invalidation: string | undefined;
    try {
      return await runRequestUnderstandingChat({ session, decisionEngine: engine, commandService: service, signal: signal.signal,
        ...(options.flag === undefined ? {} : { singletonSchemaSelectionRecovery: options.flag }),
        onResult: result => outcomes.push(result), publishResult: (_name, result) => { publications.push(result); return result; } });
    } catch (error) {
      invalidation = error instanceof RequestUnderstandingInvalidatedError ? error.reason : 'thrown';
      throw error;
    } finally {
      observations.push({ case: expect.getState().currentTestName, flag: options.flag ?? 'absent',
        stop: outcomes.at(-1)?.stop ?? invalidation, taskCompleted: outcomes.at(-1)?.stop === 'answered' && publications.length === 1,
        readerResult: outcomes.at(-1) ?? null, scriptedFetches: requests.length, requestBytes,
        metadataServiceAttempts: execute.mock.calls.length, approvedEvidence: publications.length,
        forbiddenCalls: forbidden.mock.calls.length, elapsedMs: performance.now() - began });
    }
  };
  return { db, store, session, service, execute, actualExecute, engine, requests, fetchImpl, outcomes, publications, forbidden, signal, run };
}

function noRecovery(f: Awaited<ReturnType<typeof fixture>>, stop: RequestUnderstandingResult['stop'], phases = 2) {
  expect(f.outcomes.at(-1)).toMatchObject({ stop, evaluationPhases: phases, metadataReadAttempts: 0 });
  expect(f.outcomes.at(-1)?.metadataOperationResolution).toBeUndefined();
  expect(f.requests).toHaveLength(phases); expect(f.execute).not.toHaveBeenCalled();
  expect(f.publications).toEqual([]); expect(f.forbidden).not.toHaveBeenCalled();
}

describe('default-off singleton schema selection with real Jev/session/service/local adapter', () => {
  it.each(frozen.paraphrases)('$id paired clean omission completes only when enabled', async ({ text }) => {
    for (const flag of [false, true]) {
      const f = await fixture({ flag, text });
      const reply = await f.run();
      if (!flag) { noRecovery(f, 'provider_failure'); continue; }
      const outcome = f.outcomes[0]!;
      expect(outcome).toMatchObject({ stop: 'answered', evaluationPhases: 2, metadataReadAttempts: 1,
        metadataOperationResolution: { producer: 'host_singleton', cause: 'missing_metadata_operation_answer',
          questionRef: 'metadataOperationRef', operationId: 'http:orders:schema' } });
      expect(outcome.understanding?.provenance.metadataOperationResolution).toBe(outcome.metadataOperationResolution);
      expect(Object.isFrozen(outcome.metadataOperationResolution)).toBe(true);
      expect(f.publications[0]?.data).toMatchObject({ sourceId: frozen.sourceId, sourceRevision: 1, intent: 'schema',
        scope: frozen.expectedScope, knownTotal: 2, truncated: false,
        entries: frozen.fields.map((field, index) => ({ id: `local_field_${index}`, label: field.name, fields: [{ ...field }] })) });
      for (const fact of ['OrdersAPI', 'orderId', 'string', 'quantity', '저장된 항목 구성', '알 수 없음']) expect(reply).toContain(fact);
      expect(f.requests).toHaveLength(2); expect(f.execute).toHaveBeenCalledTimes(1); expect(f.forbidden).not.toHaveBeenCalled();
      const [command, execution] = f.execute.mock.calls[0]!;
      expect(command).toEqual({ name: 'discovery.describe', args: { assetId: frozen.sourceId, depth: 'schema' } });
      expect(execution?.metadataDispatchPermit).toMatchObject({ sourceId: frozen.sourceId, operationId: 'http:orders:schema' });
      expect(() => claimMetadataDispatchPermit(execution!.metadataDispatchPermit!,
        { name: 'discovery.describe', args: { assetId: frozen.sourceId, depth: 'schema' } })).toThrow('metadata_permit_consumed');
    }
  });

  it('absent flag retains the old omission stop; ordinary valid selection is unchanged off/on', async () => {
    const absent = await fixture(); await absent.run(); noRecovery(absent, 'provider_failure');
    for (const flag of [false, true]) {
      const f = await fixture({ flag, operationBody: { answers: { metadataOperationRef: selected('metadata_0') } } });
      await f.run();
      expect(f.outcomes[0]).toMatchObject({ stop: 'answered', evaluationPhases: 2, metadataReadAttempts: 1 });
      expect(f.outcomes[0]?.metadataOperationResolution).toBeUndefined();
      expect(f.execute).toHaveBeenCalledOnce(); expect(f.publications).toHaveLength(1); expect(f.forbidden).not.toHaveBeenCalled();
    }
  });

  const operationFailures: Array<{ id: string; options: Options; stop: RequestUnderstandingResult['stop'] }> = [
    { id: 'wrong_question', options: { operationBody: { answers: { wrong_question: selected('metadata_0') } } }, stop: 'provider_failure' },
    { id: 'provider_error_with_http_200', options: { operationBody: { answers: {}, error: { type: 'permission_denied' } } }, stop: 'provider_failure' },
    { id: 'missing_container', options: { operationBody: {} }, stop: 'provider_failure' },
    { id: 'array_container', options: { operationBody: { answers: [] } }, stop: 'provider_failure' },
    { id: 'malformed_answer', options: { operationBody: { answers: { metadataOperationRef: { type: 'choice' } } } }, stop: 'provider_failure' },
    { id: 'malformed_envelope', options: { operationBody: { answers: {}, usage: { input_tokens: 'wrong' } } }, stop: 'provider_failure' },
    // A refused request (400); a 503 is retried first and is covered in jev.test.ts.
    { id: 'http_error', options: { operationBody: { answers: {}, error: 'TypeSafe response is missing answer metadataOperationRef.' }, operationStatus: 400 }, stop: 'provider_failure' },
    { id: 'transport_error', options: { transportFailure: true }, stop: 'provider_failure' },
    { id: 'tie', options: { operationBody: { answers: { metadataOperationRef: selected('metadata_0', { metadata_0: 0.5, unknown: 0.5 }) } } }, stop: 'invalid_decision' },
    { id: 'subthreshold', options: { operationBody: { answers: { metadataOperationRef: selected('metadata_0', { metadata_0: 0.49 }) } } }, stop: 'invalid_decision' },
    ...['none', 'unknown', 'unsupported'].map(escape => ({ id: escape,
      options: { operationBody: { answers: { metadataOperationRef: selected(escape) } } },
      stop: escape === 'unsupported' ? 'unsupported_operation' as const : 'metadata_unavailable' as const })),
  ];
  it.each(operationFailures)('$id is ineligible with the flag off/on', async ({ options, stop }) => {
    for (const flag of [false, true]) { const f = await fixture({ ...options, flag }); await f.run(); noRecovery(f, stop); }
  });

  const unresolved: Array<{ id: string; text: string; initial: Record<string, unknown>; stop: RequestUnderstandingResult['stop'] }> = [
    { id: 'goal_absent', text: 'OrdersAPI', initial: { intent: selected('ambiguous') }, stop: 'ambiguous_intent' },
    { id: 'target_absent', text: '필드 알려줘', initial: { targetSourceRef: selected('none') }, stop: 'source_required' },
    { id: 'unresolved_pronoun', text: '그거 필드 알려줘', initial: { targetSourceRef: selected('ambiguous') }, stop: 'source_ambiguous' },
    { id: 'unknown_source', text: 'OtherAPI 필드 알려줘', initial: { targetSourceRef: selected('unknown') }, stop: 'candidate_coverage_incomplete' },
    { id: 'unsupported_goal', text: 'OrdersAPI 내일 매출 예측해줘', initial: { intent: selected('unsupported') }, stop: 'unsupported_intent' },
    { id: 'retrieval', text: 'OrdersAPI 주문 레코드 보여줘', initial: { intent: selected('retrieval') }, stop: 'outside_slice' },
    { id: 'action', text: 'OrdersAPI 주문 삭제해줘', initial: { intent: selected('action') }, stop: 'outside_slice' },
  ];
  it.each(unresolved)('$id cannot gain user authority from source availability off/on', async ({ text, initial, stop }) => {
    for (const flag of [false, true]) { const f = await fixture({ flag, text, initial }); await f.run(); noRecovery(f, stop, 1); }
  });

  const ineligible: Array<{ id: string; options: Options }> = [
    { id: 'nonlocal', options: { localAdapter: false } },
    { id: 'missing_host_currentness_producer', options: { hostCurrent: false } },
    { id: 'raw', options: { text: 'OrdersAPI 스키마 JSON으로 출력해줘', initial: { outputKind: selected('raw_debug') } } },
    { id: 'inventory', options: { initial: { intent: selected('inventory') } } },
    { id: 'status', options: { initial: { intent: selected('connection_status') } } },
    { id: 'denied', options: { changeCatalog: catalog => { catalog.sources[0]!.operations.find(op => op.intent === 'schema')!.allowed = false; } } },
    { id: 'two_schema_operations_including_denied', options: { changeCatalog: catalog => {
      const source = catalog.sources[0]!;
      source.operations.push({ ...source.operations.find(op => op.intent === 'schema')!, id: 'http:orders:schema:second', allowed: false });
      source.operationCoverage.knownTotal = 4;
    } } },
    { id: 'source_truncation', options: { changeCatalog: catalog => { catalog.coverage.truncated = true; } } },
    { id: 'operation_overflow', options: { changeCatalog: catalog => { catalog.sources[0]!.operationCoverage.overflow = true; } } },
    { id: 'unknown_operation_total', options: { changeCatalog: catalog => {
      catalog.sources[0]!.operationCoverage.knownTotal = null; catalog.sources[0]!.operationCoverage.truncated = true;
    } } },
    { id: 'non_http_asset_binding', options: { changeCatalog: catalog => {
      const source = catalog.sources[0]!; source.assetId = 'other:orders';
      for (const operation of source.operations) if (operation.command.name === 'discovery.describe') operation.command.args.assetId = source.assetId;
    } } },
  ];
  it.each(ineligible)('$id fails the session singleton predicate off/on', async ({ options }) => {
    for (const flag of [false, true]) { const f = await fixture({ ...options, flag }); await f.run(); noRecovery(f, 'provider_failure'); }
  });

  it('a valid explicitly selected denied operation keeps permission_denied off/on', async () => {
    for (const flag of [false, true]) {
      const f = await fixture({ flag, operationBody: { answers: { metadataOperationRef: selected('metadata_0') } },
        changeCatalog: catalog => { catalog.sources[0]!.operations.find(op => op.intent === 'schema')!.allowed = false; } });
      await f.run(); noRecovery(f, 'permission_denied');
    }
  });

  it.each([
    { id: 'missing_dictionary', options: { missingDictionary: true }, stop: 'metadata_unavailable' },
    { id: 'wrong_revision', options: { corruptResult: (result: AxCommandResult) => ({ ...result, data: { ...(result.data as object), sourceRevision: 2 } }) }, stop: 'metadata_unavailable' },
    { id: 'bad_shape', options: { corruptResult: (result: AxCommandResult) => ({ ...result, data: { ...(result.data as object), entries: 'bad' } }) }, stop: 'metadata_unavailable' },
    { id: 'oversized', options: { corruptResult: (result: AxCommandResult) => ({ ...result, data: { ...(result.data as object), oversized: 'x'.repeat(32_769) } }) }, stop: 'metadata_budget_exhausted' },
  ])('$id charges the one failed first read and does not retry off/on', async ({ options, stop }) => {
    for (const flag of [false, true]) {
      const f = await fixture({ ...options, flag }); await f.run();
      if (!flag) { noRecovery(f, 'provider_failure'); continue; }
      expect(f.outcomes[0]).toMatchObject({ stop, metadataReadAttempts: 1, evaluationPhases: 2,
        metadataOperationResolution: { cause: 'missing_metadata_operation_answer' } });
      expect(f.outcomes[0]?.understanding).toBeUndefined(); expect(f.execute).toHaveBeenCalledOnce();
      expect(f.requests).toHaveLength(2); expect(f.publications).toEqual([]); expect(f.forbidden).not.toHaveBeenCalled();
    }
  });

  it.each(['cancel', 'correction', 'catalog', 'connection', 'dictionary'] as const)('%s before the omitted answer prevents dispatch and publication', async kind => {
    for (const flag of [false, true]) {
      const f = await fixture({ flag, beforeOperationReply: (session, store) => {
        if (kind === 'cancel') session.cancel();
        if (kind === 'correction') session.acceptCorrection({ text: '아니 취소해', requestId: 'new-turn', supersedes: ['intent'] });
        if (kind === 'catalog') session.replaceCatalog({ ...session.catalog, revision: 2, policyRevision: 2 });
        if (kind === 'connection') store.setConnection('http', false, { endpoints: [] });
        if (kind === 'dictionary') store.deleteDiscoveryMetadata(frozen.sourceId);
      } });
      await expect(f.run()).rejects.toBeInstanceOf(RequestUnderstandingInvalidatedError);
      expect(f.requests).toHaveLength(2); expect(f.execute).not.toHaveBeenCalled();
      expect(f.outcomes).toEqual([]); expect(f.publications).toEqual([]); expect(f.forbidden).not.toHaveBeenCalled();
    }
  });

  it.each(['cancel', 'dictionary'] as const)('%s after the actual first read suppresses publication without retry', async kind => {
    for (const flag of [false, true]) {
      const f = await fixture({ flag });
      f.execute.mockImplementation(async (...args) => {
        const result = await f.actualExecute(...args);
        if (kind === 'cancel') f.session.cancel();
        else f.store.deleteDiscoveryMetadata(frozen.sourceId);
        return result;
      });
      if (!flag) { await f.run(); noRecovery(f, 'provider_failure'); continue; }
      await expect(f.run()).rejects.toBeInstanceOf(RequestUnderstandingInvalidatedError);
      expect(f.execute).toHaveBeenCalledOnce(); expect(f.requests).toHaveLength(2);
      expect(f.outcomes).toEqual([]); expect(f.publications).toEqual([]); expect(f.forbidden).not.toHaveBeenCalled();
    }
  });

  it('a plain error with the same human message never qualifies', async () => {
    const f = await fixture({ flag: true });
    const actual = f.engine.evaluate.bind(f.engine);
    vi.spyOn(f.engine, 'evaluate').mockImplementation(request => request.questions.metadataOperationRef
      ? Promise.reject(new Error('TypeSafe response is missing answer metadataOperationRef.')) : actual(request));
    await f.run();
    expect(f.outcomes[0]).toMatchObject({ stop: 'provider_failure', metadataReadAttempts: 0 });
    expect(f.outcomes[0]?.metadataOperationResolution).toBeUndefined(); expect(f.execute).not.toHaveBeenCalled();
    expect(f.requests).toHaveLength(1);
    expect(new JevDecisionError('same text').failure).toBeUndefined();
  });
});
