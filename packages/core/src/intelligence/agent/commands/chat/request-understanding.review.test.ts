// The ten independent reviewer probes are retained below; supplemental regressions are separate.
import { afterAll, describe, expect, it, vi } from 'vitest';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createDatabaseAsync } from '../../../../persistence/db.js';
import { WorkflowStore } from '../../../../persistence/workflow-store.js';
import type { DecisionAnswer, DecisionEngine, DecisionEvaluationRequest } from '../../../../contracts/decision.js';
import type { ConnectorFailureKind } from '../../../../connectors/types.js';
import type { MetadataCatalog, RequestUnderstandingResult } from '../../../../contracts/request-understanding.js';
import { RequestUnderstandingSession } from '../../../decision/request-understanding/session.js';
import { AgentHarness } from '../../harness.js';
import { AxCommandService } from '../service.js';
import type { AxCommandReadGateway } from '../read-gateway.js';
import { runAxCommandChat } from '../chat.js';
import { scriptedModel } from './fixtures.js';
import { deterministicMetadataChatReply, deterministicHttpConnectionListChatReply } from './result.js';
import { explicitlyRequestsRawMetadata } from './metadata-output.js';
import { buildDesignToolContext } from '../../../design-tools/context.js';
import { sourceManifestPage } from '../../source-manifest.js';
import { AGENT_COMMAND_CONTEXT } from '../access.js';
import type { AxCommand } from '../schema.js';

vi.mock('../../../../persistence/paths/app-log.js', () => ({ appendAppLog: vi.fn() }));
const observations: Array<Record<string, unknown>> = [];
afterAll(() => {
  if (process.env.AX_JEV_REVIEW_EVIDENCE === '1' && process.env.AX_DATA_ROOT) {
    writeFileSync(join(process.env.AX_DATA_ROOT, 'review-repro-observations.json'), JSON.stringify(observations, null, 2));
  }
});
const selected = (choice: string): DecisionAnswer => ({ type: 'choice', choice, probabilities: { [choice]: 1 } });
function catalog(): MetadataCatalog {
  const coverage = { knownTotal: 2, truncated: false, overflow: false, retrievalMethod: 'configured_registry' as const };
  return { revision: 1, policyRevision: 1, coverage, sources: ['a', 'b'].map(id => ({
    id, label: `source ${id.toUpperCase()}`, revision: 1, aliases: [], assetId: `asset:${id}`,
    operationCoverage: { ...coverage, knownTotal: 1 }, operations: [{ id: `inventory:${id}`, intent: 'inventory',
      label: 'registered inventory', allowed: true,
      command: { name: 'discovery.describe', args: { assetId: `asset:${id}`, depth: 'summary' } },
    }],
  })) };
}
const evidence = (id: string) => ({ sourceId: id, sourceRevision: 1, intent: 'inventory',
  entries: [{ id: `${id}-products`, label: `${id}-products` }], knownTotal: 1, truncated: false });
function finiteChoices(request: DecisionEvaluationRequest, output = 'readable_inventory', operation = 'metadata_0') {
  const revision = (request.state as { active_request_revision: number }).active_request_revision;
  return request.questions.intent ? { intent: selected('inventory'), targetSourceRef: selected(revision === 2 ? 'source_1' : 'source_0'),
    outputKind: selected(output) } : { metadataOperationRef: selected(operation) };
}
async function experimental(input: { text?: string; output?: string; operation?: string; source?: string;
  failure?: ConnectorFailureKind; malformed?: boolean; malformedScores?: string }) {
  const db = await createDatabaseAsync(':memory:');
  const session = new RequestUnderstandingSession({ text: input.text ?? 'source A 등록된 데이터 목록 보여줘',
    requestId: 'review-request', workspaceSessionId: 'review-session', catalog: catalog() });
  const gateway: AxCommandReadGateway = { execute: vi.fn<AxCommandReadGateway['execute']>(async request => input.failure
    ? { tool: request.tool, ok: false, error: `synthetic_${input.failure}`, failureKind: input.failure }
    : { tool: request.tool, ok: true, data: evidence(request.args.assetId === 'asset:b' ? 'b' : 'a') }) };
  const enqueue = vi.fn();
  const service = new AxCommandService(new WorkflowStore(db), { readGateway: gateway, enqueueOnce: enqueue });
  const outcomes: RequestUnderstandingResult[] = [];
  const published: unknown[] = [];
  const engine: DecisionEngine = { dataHandling: 'local', evaluate: async request => ({ answers: input.malformed && request.questions.intent
    ? JSON.parse('{"intent":{"type":"choice","choice":"inventory"},"targetSourceRef":{"type":"choice","choice":"source_0","probabilities":{"source_0":1}},"outputKind":{"type":"choice","choice":"readable_inventory","probabilities":{"readable_inventory":1}}}')
    : (() => {
      const answers = finiteChoices(request, input.output, input.operation);
      if (request.questions.intent && input.source) answers.targetSourceRef = selected(input.source);
      if (request.questions.intent && input.malformedScores) answers.intent = JSON.parse(input.malformedScores);
      return answers;
    })() }) };
  const model = scriptedModel([], [], 'review-script');
  const generateText = vi.spyOn(model, 'generateText');
  const generateStructured = vi.spyOn(model, 'generateStructured');
  const run = () => runAxCommandChat({ harness: new AgentHarness(model), commandService: service, decisionEngine: engine,
    requestId: session.capture().anchor.originalRequestId, workspaceSessionId: 'review-session', requestAnchor: session.capture().anchor,
    messages: [], userMessage: session.capture().anchor.text, requestUnderstanding: { session, onResult: outcome => outcomes.push(outcome) },
    onCommandResult: result => published.push(result.data) });
  return { db, session, gateway, enqueue, outcomes, published, run, generateText, generateStructured };
}

describe('independent ac5feca expected-behavior reproductions', () => {
  it('does not say a stored disconnected HTTP endpoint is absent', async () => {
    const db = await createDatabaseAsync(':memory:');
    try {
      const store = new WorkflowStore(db);
      store.setConnection('http', false, { endpoints: [{ id: 'saved', label: 'Saved API', baseUrl: 'https://synthetic.invalid', authType: 'none' }] });
      const service = new AxCommandService(store);
      const command: AxCommand = { name: 'http.list', args: {} };
      const result = await service.execute(command, { executionContext: AGENT_COMMAND_CONTEXT });
      const reply = deterministicHttpConnectionListChatReply(command, result, '저장된 HTTP 연결 목록 보여줘');
      observations.push({ probe: 'F5-saved-disconnected', reply, data: result.data });
      expect(result.status).toBe('ok');
      expect(reply).toContain('Saved API');
      expect(reply).not.toContain('저장된 연결 없음');
      expect(reply).toContain('연결 안 됨');
      expect(reply).toContain('실제로 접속되는지는 확인하지 않았어요');
    } finally { db.close?.(); }
  });

  it('preserves real nonempty discovery.search candidates in a full legacy chat/service run', async () => {
    const db = await createDatabaseAsync(':memory:');
    try {
      const ctx = buildDesignToolContext([{ connector: 'http', connected: true, config: {
        endpoints: [{ id: 'dummy', label: 'DummyJSON', baseUrl: 'https://synthetic.invalid', authType: 'none' }],
      } }], ['http']);
      const service = new AxCommandService(new WorkflowStore(db));
      const execute = vi.spyOn(service, 'execute');
      const published: unknown[] = [];
      const model = scriptedModel([], [], 'review-script');
      const text = vi.spyOn(model, 'generateText');
      const reply = await runAxCommandChat({ harness: new AgentHarness(model), commandService: service,
        decisionEngine: { evaluate: async () => ({ answers: { route: selected('discovery_search') } }) },
        designToolContext: ctx, messages: [], userMessage: 'DummyJSON 목록 보여줘', onCommandResult: result => published.push(result.data) });
      const data = published[0] as { candidates: unknown[]; totalMatches: number };
      observations.push({ probe: 'F1-real-search', reply, data, commands: execute.mock.calls.map(call => call[0]), modelCalls: text.mock.calls.length });
      expect(data.candidates.length).toBeGreaterThan(0);
      expect(text).not.toHaveBeenCalled();
      expect(reply).toContain('DummyJSON');
      expect(reply).not.toContain('등록된 항목이 없습니다');
    } finally { db.close?.(); }
  });

  it('preserves registered API operations and nested coverage from real discovery.describe', async () => {
    const db = await createDatabaseAsync(':memory:');
    try {
      const paths = Object.fromEntries(['products', 'users', ...Array.from({ length: 7 }, (_, i) => `extra${i}`)].map(name =>
        [`/${name}`, { get: { operationId: `list_${name}`, responses: { '200': { description: 'synthetic' } } } }]));
      const ctx = buildDesignToolContext([{ connector: 'openapi', connected: true, config: {
        specId: 'catalog', baseUrl: 'https://synthetic.invalid', specJson: {
          openapi: '3.0.0', info: { title: 'Synthetic Catalog', version: '1' }, servers: [{ url: 'https://synthetic.invalid' }], paths,
        },
      } }], ['openapi']);
      const service = new AxCommandService(new WorkflowStore(db));
      const command: AxCommand = { name: 'discovery.describe', args: { assetId: 'openapi:catalog', depth: 'summary' } };
      const result = await service.execute(command, { executionContext: AGENT_COMMAND_CONTEXT, designToolContext: ctx });
      const reply = deterministicMetadataChatReply(command, result, '등록된 API 목록 보여줘');
      observations.push({ probe: 'F1-real-describe', reply, data: result.data });
      expect(result.status).toBe('ok');
      expect(JSON.stringify(result.data)).toContain('list_products');
      expect(JSON.stringify(result.data)).toContain('"truncated":true');
      expect(reply).toContain('products');
      expect(reply).toContain('일부');
    } finally { db.close?.(); }
  });

  it('shows filenames from the real session source manifest shape', () => {
    const command: AxCommand = { name: 'session.source.list', args: {} };
    const data = sourceManifestPage([{ id: 'opaque-1', fileName: 'synthetic-report.pdf', status: 'ready' }]);
    const reply = deterministicMetadataChatReply(command, { command: command.name, status: 'ok', data, issues: [], inputRequests: [] }, '현재 대화 자료 목록을 보여줘');
    observations.push({ probe: 'F1-filename', reply, data });
    expect(reply).toContain('synthetic-report.pdf');
  });

  it('honors explicit refusal of raw JSON through real legacy chat/service', async () => {
    const db = await createDatabaseAsync(':memory:');
    try {
      const service = new AxCommandService(new WorkflowStore(db));
      const model = scriptedModel([], [], 'review-script');
      const text = vi.spyOn(model, 'generateText');
      const userMessage = '리소스 목록은 raw JSON 말고 목록으로 보여줘';
      const reply = await runAxCommandChat({ harness: new AgentHarness(model), commandService: service,
        decisionEngine: { evaluate: async () => ({ answers: { route: selected('resource_list') } }) }, messages: [], userMessage });
      observations.push({ probe: 'F2-negated-raw', userMessage, rawSyntaxGate: explicitlyRequestsRawMetadata(userMessage), reply, modelCalls: text.mock.calls.length });
      expect(text).not.toHaveBeenCalled();
      expect(reply).not.toContain('```json');
    } finally { db.close?.(); }
  });

  it('keeps unsuperseded raw output after a target-only correction', async () => {
    const setup = await experimental({ text: 'source A 등록된 데이터 raw JSON으로 보여줘', output: 'raw_debug' });
    try {
      const originalReply = await setup.run();
      setup.session.acceptCorrection({ text: '아니, source B를 말한 거야', requestId: 'corrected-turn', supersedes: ['targetSourceRef'] });
      const correctedReply = await setup.run();
      observations.push({ probe: 'F3-preserved-output', originalReply, correctedReply, turns: setup.session.userTurns,
        outcomes: setup.outcomes, gatewayCalls: vi.mocked(setup.gateway.execute).mock.calls.length, published: setup.published });
      expect(originalReply).toContain('```json');
      expect(setup.session.userTurns[1]?.supersedes).toEqual(['targetSourceRef']);
      expect(correctedReply).toContain('```json');
      expect(correctedReply).toContain('b-products');
    } finally { setup.db.close?.(); }
  });

  it.each(['permission_denied', 'provider_error'] as const)('preserves gateway failure kind %s', async failure => {
    const setup = await experimental({ failure });
    try {
      const reply = await setup.run();
      observations.push({ probe: 'F4-failure-classification', failureKind: failure, reply, stop: setup.outcomes.at(-1)?.stop,
        gatewayCalls: vi.mocked(setup.gateway.execute).mock.calls.length, published: setup.published });
      expect(setup.published).toEqual([]);
      expect(setup.outcomes.at(-1)?.stop).toBe(failure === 'permission_denied' ? 'permission_denied' : 'provider_failure');
    } finally { setup.db.close?.(); }
  });

  it('distinguishes unsupported metadata capability from unavailable metadata', async () => {
    const setup = await experimental({ operation: 'unsupported' });
    try {
      const reply = await setup.run();
      observations.push({ probe: 'F4-unsupported', reply, stop: setup.outcomes.at(-1)?.stop, gatewayCalls: vi.mocked(setup.gateway.execute).mock.calls.length });
      expect(setup.gateway.execute).not.toHaveBeenCalled();
      expect(setup.outcomes.at(-1)?.stop).not.toBe('metadata_unavailable');
    } finally { setup.db.close?.(); }
  });

  it('labels a missing probability object as an invalid decision rather than provider outage', async () => {
    const setup = await experimental({ malformed: true });
    try {
      const reply = await setup.run();
      observations.push({ probe: 'F4-malformed', reply, stop: setup.outcomes.at(-1)?.stop, gatewayCalls: vi.mocked(setup.gateway.execute).mock.calls.length });
      expect(setup.gateway.execute).not.toHaveBeenCalled();
      expect(setup.outcomes.at(-1)?.stop).toBe('invalid_decision');
    } finally { setup.db.close?.(); }
  });
});

describe('supplemental prepublication regressions (outside the original 24-case corpus)', () => {
  it.each([
    'show resources, do not use raw JSON',
    'show resources, not raw JSON',
    '리소스 목록은 원시 JSON 없이 보여줘',
    '"raw JSON"이란 용어를 설명해줘',
    'show the resources mentioned in `raw JSON`',
    'what does raw JSON mean?',
  ])('does not authorize raw output from refusal or mention: %s', text => {
    expect(explicitlyRequestsRawMetadata(text)).toBe(false);
  });

  it.each(['show resources as raw JSON', '리소스 목록을 디버그 JSON으로 출력해줘'])('retains affirmative raw syntax: %s', text => {
    expect(explicitlyRequestsRawMetadata(text)).toBe(true);
  });

  it('replaces explicitly superseded output and retains the source field through the actual chat/service seam', async () => {
    const options = { text: 'source A 등록된 데이터 raw JSON으로 보여줘', output: 'raw_debug', source: 'source_0' };
    const setup = await experimental(options);
    try {
      expect(await setup.run()).toContain('```json');
      setup.session.acceptCorrection({ text: 'JSON 말고 읽기 쉬운 목록으로 보여줘', requestId: 'readable-turn', supersedes: ['outputKind'] });
      options.output = 'readable_inventory';
      const reply = await setup.run();
      expect(reply).toContain('a-products');
      expect(reply).not.toContain('```json');
      const current = setup.outcomes.at(-1)!;
      expect(current.stop).toBe('answered');
      expect(current.requestRevision).toBe(2);
      expect(current.understanding?.targetSourceRef).toBe('a');
      expect(current.understanding?.provenance.fieldAuthorities).toEqual({
        intent: { requestDigest: setup.session.originalAnchor.digest, requestRevision: 1 },
        targetSourceRef: { requestDigest: setup.session.originalAnchor.digest, requestRevision: 1 },
        outputKind: { requestDigest: setup.session.userTurns[1]!.anchor.digest, requestRevision: 2 },
      });
      expect(setup.session.sourceCandidates(setup.session.capture())[0]?.spans[0]?.text).toBe('source A');
      expect(setup.generateText).not.toHaveBeenCalled();
      expect(setup.generateStructured).not.toHaveBeenCalled();
    } finally { setup.db.close?.(); }
  });

  it('does not recover superseded raw authorization from an older turn', async () => {
    const options = { text: 'source A 등록된 데이터 raw JSON으로 보여줘', output: 'raw_debug' };
    const setup = await experimental(options);
    try {
      expect(await setup.run()).toContain('```json');
      setup.session.acceptCorrection({ text: 'source B로 바꾸고 raw JSON 말고 목록으로 보여줘', requestId: 'refusal-turn',
        supersedes: ['targetSourceRef', 'outputKind'] });
      expect(await setup.run()).not.toContain('```json');
      expect(setup.outcomes.at(-1)?.stop).toBe('output_ambiguous');
      setup.session.acceptCorrection({ text: 'source B를 다시 확인해줘', requestId: 'third-turn', supersedes: ['targetSourceRef'] });
      expect(await setup.run()).not.toContain('```json');
      expect(setup.outcomes.at(-1)?.stop).toBe('output_ambiguous');
      expect(setup.gateway.execute).toHaveBeenCalledOnce();
      expect(setup.published).toHaveLength(1);
    } finally { setup.db.close?.(); }
  });

  it.each([
    '{"type":"choice","choice":"inventory","probabilities":null}',
    '{"type":"choice","choice":"inventory","probabilities":[]}',
    '{"type":"choice","choice":"inventory","probabilities":{"inventory":"1"}}',
  ])('rejects malformed probability payloads without a metadata call: %s', async malformedScores => {
    const setup = await experimental({ malformedScores });
    try {
      await setup.run();
      expect(setup.outcomes.at(-1)?.stop).toBe('invalid_decision');
      expect(setup.gateway.execute).not.toHaveBeenCalled();
      expect(setup.published).toEqual([]);
    } finally { setup.db.close?.(); }
  });

  it.each([
    ['permission_denied', 'permission_denied', '권한'],
    ['provider_error', 'provider_failure', '서비스'],
    ['transient', 'provider_failure', '서비스'],
    ['not_found', 'metadata_unavailable', '구성 정보를 확인하지 못했습니다'],
  ] as const)('reports %s as %s with no substitute read or queue', async (failure, stop, fact) => {
    const setup = await experimental({ failure });
    try {
      expect(await setup.run()).toContain(fact);
      expect(setup.outcomes.at(-1)?.stop).toBe(stop);
      expect(setup.gateway.execute).toHaveBeenCalledOnce();
      expect(vi.mocked(setup.gateway.execute).mock.calls[0]?.[0].tool).toBe('discovery.describe');
      expect(setup.enqueue).not.toHaveBeenCalled();
      expect(setup.published).toEqual([]);
      expect(setup.generateText).not.toHaveBeenCalled();
      expect(setup.generateStructured).not.toHaveBeenCalled();
    } finally { setup.db.close?.(); }
  });

  it('preserves HTTP endpoint labels in the real resource.list producer', async () => {
    const db = await createDatabaseAsync(':memory:');
    try {
      const store = new WorkflowStore(db);
      store.setConnection('http', true, { endpoints: [{ id: 'saved', label: 'Saved API', baseUrl: 'https://synthetic.invalid', authType: 'none' }] });
      const command: AxCommand = { name: 'resource.list', args: {} };
      const result = await new AxCommandService(store).execute(command, { executionContext: AGENT_COMMAND_CONTEXT });
      expect(deterministicMetadataChatReply(command, result, '리소스 목록 보여줘')).toContain('Saved API');
      expect(deterministicMetadataChatReply(command, result, '리소스 raw JSON으로 보여줘')).not.toContain('synthetic.invalid');
    } finally { db.close?.(); }
  });

  it('preserves fieldPage completeness and cursor from real discovery.describe metadata', async () => {
    const db = await createDatabaseAsync(':memory:');
    try {
      const ctx = buildDesignToolContext([{ connector: 'rdb', connected: true, config: { allowedTables: ['orders'] } }], ['rdb'], {
        discoveryMetadata: [{ assetId: 'rdb:orders', aliases: [], updatedAt: '2026-10-02T00:00:00Z',
          fields: Array.from({ length: 10 }, (_, i) => ({ name: `field${i}`, type: 'string', description: 'registered field' })) }],
      });
      const command: AxCommand = { name: 'discovery.describe', args: { assetId: 'rdb:orders', depth: 'summary' } };
      const result = await new AxCommandService(new WorkflowStore(db)).execute(command, { executionContext: AGENT_COMMAND_CONTEXT, designToolContext: ctx });
      expect(result.status).toBe('ok');
      const reply = deterministicMetadataChatReply(command, result, '스키마 목록 보여줘');
      expect(reply).toContain('field0');
      expect(reply).toContain('string');
      expect(reply).toContain('일부');
      expect(reply).toContain('9번째 항목부터 이어서 볼 수 있습니다');
      expect(reply).toContain('10개');
      expect(reply).not.toContain('field9');
    } finally { db.close?.(); }
  });

  it('does not call a nonempty unknown envelope empty based on its counters', () => {
    const command: AxCommand = { name: 'discovery.search', args: {} };
    const reply = deterministicMetadataChatReply(command, { command: command.name, status: 'ok', issues: [], inputRequests: [],
      data: { unknownRows: [{ label: 'unrecognized' }], totalMatches: 1, truncated: false } }, '목록 보여줘');
    expect(reply).toContain('정보의 형식을 확인하지 못했습니다');
    expect(reply).not.toContain('등록된 항목이 없습니다');
  });
});
