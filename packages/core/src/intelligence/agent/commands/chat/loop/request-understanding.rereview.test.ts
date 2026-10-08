// Independent expected-behavior probes for the immutable 487f8ea candidate.
// These tests deliberately fail when a preserved user requirement is lost.
import { afterAll, describe, expect, it, vi } from 'vitest';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createDatabaseAsync } from '../../../../../persistence/db.js';
import { WorkflowStore } from '../../../../../persistence/workflow-store.js';
import type { DecisionAnswer, DecisionEngine } from '../../../../../contracts/decision.js';
import type { MetadataCatalog, RequestUnderstandingResult } from '../../../../../contracts/request-understanding.js';
import { RequestUnderstandingSession } from '../../../../decision/request-understanding/session.js';
import { AgentHarness } from '../../../harness.js';
import { AxCommandService } from '../../service.js';
import { runAxCommandChat } from '../../chat.js';
import { scriptedModel } from '../testing/fixtures.js';
import { deterministicMetadataChatReply } from '../result/index.js';
import { explicitlyRequestsRawMetadata } from '../shared/metadata-output.js';
import { buildDesignToolContext } from '../../../../design-tools/context.js';
import { AGENT_COMMAND_CONTEXT } from '../../access.js';
import type { AxCommand } from '../../schema.js';

vi.mock('../../../../../persistence/paths/app-log.js', () => ({ appendAppLog: vi.fn() }));
const observations: Array<Record<string, unknown>> = [];
afterAll(() => {
  if (process.env.AX_JEV_REREVIEW_EVIDENCE === '1' && process.env.AX_DATA_ROOT) {
    writeFileSync(join(process.env.AX_DATA_ROOT, 'rereview-adversarial-observations.json'), JSON.stringify(observations, null, 2));
  }
});
const selected = (choice: string): DecisionAnswer => ({ type: 'choice', choice, probabilities: { [choice]: 1 } });

describe('independent 487f8ea semantic regression probes', () => {
  it.each([
    '리소스 목록을 raw JSON으로 보여주지 마.',
    '리소스 목록을 raw JSON으로 출력해 주지 마.',
    '리소스 목록을 raw JSON으로 보여줄 필요 없어.',
  ])('honors Korean raw refusal through actual legacy chat/service: %s', async userMessage => {
    const db = await createDatabaseAsync(':memory:');
    try {
      const service = new AxCommandService(new WorkflowStore(db));
      const execute = vi.spyOn(service, 'execute');
      const model = scriptedModel([], [], 'independent-rereview');
      const generateText = vi.spyOn(model, 'generateText');
      const generateStructured = vi.spyOn(model, 'generateStructured');
      const reply = await runAxCommandChat({ harness: new AgentHarness(model), commandService: service,
        decisionEngine: { evaluate: async () => ({ answers: { route: selected('resource_list') } }) }, messages: [], userMessage });
      observations.push({ probe: 'R1-Korean-raw-refusal', userMessage, reply,
        rawSyntaxGate: explicitlyRequestsRawMetadata(userMessage), commands: execute.mock.calls.map(call => call[0]),
        modelCalls: { text: generateText.mock.calls.length, structured: generateStructured.mock.calls.length } });
      expect(generateText).not.toHaveBeenCalled();
      expect(generateStructured).not.toHaveBeenCalled();
      expect(reply).not.toContain('```json');
    } finally { db.close?.(); }
  });

  it.each([
    { probe: 'R2-empty-current-page', query: 'DummyJSON', offset: 1, expectedTotal: 1 },
    { probe: 'control-zero-matches', query: 'A7FFFF9ZZMissing', offset: 0, expectedTotal: 0 },
  ])('distinguishes current-page emptiness from total matches: $probe', async fixture => {
    const db = await createDatabaseAsync(':memory:');
    try {
      const ctx = buildDesignToolContext([{ connector: 'http', connected: true, config: {
        endpoints: [{ id: 'dummy', label: 'DummyJSON', baseUrl: 'https://synthetic.invalid', authType: 'none' }],
      } }], ['http']);
      const service = new AxCommandService(new WorkflowStore(db));
      const command: AxCommand = { name: 'discovery.search', args: {
        query: fixture.query, kind: 'http_endpoint', offset: fixture.offset, limit: 8,
      } };
      const result = await service.execute(command, { executionContext: AGENT_COMMAND_CONTEXT, designToolContext: ctx });
      const reply = deterministicMetadataChatReply(command, result, 'DummyJSON 등록된 목록 보여줘');
      observations.push({ probe: fixture.probe, command, reply, status: result.status, data: result.data });
      expect(result.status).toBe('ok');
      expect(result.data).toMatchObject({ candidates: [], totalMatches: fixture.expectedTotal, truncated: false });
      if (fixture.expectedTotal > 0) expect(reply).not.toContain('등록된 항목이 없습니다.');
      else expect(reply).toContain('등록된 항목이 없습니다.');
    } finally { db.close?.(); }
  });

  it.each([
    { probe: 'R3-required-parameter-fact', userMessage: 'rdb.query.read 필수 파라미터 목록 알려줘', expectedFact: '필수' },
    { probe: 'R3-output-contract-fact', userMessage: 'rdb.query.read 입출력 스키마 보여줘', expectedFact: 'TableArtifact' },
  ])('preserves real capability contract facts in readable output: $probe', async fixture => {
    const db = await createDatabaseAsync(':memory:');
    try {
      const service = new AxCommandService(new WorkflowStore(db));
      const command: AxCommand = { name: 'capability.describe', args: { id: 'rdb.query.read' } };
      const result = await service.execute(command, { executionContext: AGENT_COMMAND_CONTEXT });
      const reply = deterministicMetadataChatReply(command, result, fixture.userMessage);
      const rawReply = deterministicMetadataChatReply(command, result, 'rdb.query.read 스키마를 raw JSON으로 보여줘');
      observations.push({ probe: fixture.probe, userMessage: fixture.userMessage, command,
        status: result.status, data: result.data, reply, rawReply });
      expect(result.status).toBe('ok');
      expect(JSON.stringify(result.data)).toContain('"required":true');
      expect(JSON.stringify(result.data)).toContain('TableArtifact');
      expect(reply).toContain(fixture.expectedFact);
    } finally { db.close?.(); }
  });

  it('retains unsuperseded unsupported intent detail after a target-only correction', async () => {
    const db = await createDatabaseAsync(':memory:');
    try {
      const coverage = { knownTotal: 2, truncated: false, overflow: false, retrievalMethod: 'configured_registry' as const };
      const catalog: MetadataCatalog = { revision: 1, policyRevision: 1, coverage,
        sources: ['a', 'b'].map(id => ({ id, label: `source ${id.toUpperCase()}`, revision: 1,
          aliases: [], assetId: `asset:${id}`, operationCoverage: { ...coverage, knownTotal: 0 }, operations: [] })) };
      const originalText = 'source A로 주가 예측해 봐';
      const session = new RequestUnderstandingSession({ text: originalText, requestId: 'unsupported-request',
        workspaceSessionId: 'unsupported-session', catalog });
      const service = new AxCommandService(new WorkflowStore(db));
      const execute = vi.spyOn(service, 'execute');
      const model = scriptedModel([], [], 'independent-rereview');
      const generateText = vi.spyOn(model, 'generateText');
      const engine: DecisionEngine = { dataHandling: 'local', evaluate: async request => ({ answers: {
        intent: selected('unsupported'),
        targetSourceRef: selected((request.state as { active_request_revision: number }).active_request_revision === 1 ? 'source_0' : 'source_1'),
        outputKind: selected('not_stated'),
      } }) };
      const outcomes: RequestUnderstandingResult[] = [];
      const run = () => runAxCommandChat({ harness: new AgentHarness(model), commandService: service, decisionEngine: engine,
        requestId: session.capture().anchor.originalRequestId, workspaceSessionId: 'unsupported-session',
        requestAnchor: session.capture().anchor, messages: [], userMessage: session.capture().anchor.text,
        requestUnderstanding: { session, onResult: result => outcomes.push(result) } });
      const originalReply = await run();
      session.acceptCorrection({ text: '아니, source B를 말한 거야', requestId: 'unsupported-correction', supersedes: ['targetSourceRef'] });
      const correctedReply = await run();
      observations.push({ probe: 'R4-retained-unsupported-intent', originalText, originalReply, correctedReply,
        turns: session.userTurns, fieldAuthorities: session.capture().fieldAuthorities, outcomes,
        commands: execute.mock.calls.map(call => call[0]), modelCalls: generateText.mock.calls.length });
      expect(originalReply).toContain('주가 예측해 봐');
      expect(outcomes.map(outcome => outcome.stop)).toEqual(['unsupported_intent', 'unsupported_intent']);
      expect(execute).not.toHaveBeenCalled();
      expect(generateText).not.toHaveBeenCalled();
      expect(session.capture().fieldAuthorities.intent.requestRevision).toBe(1);
      expect(correctedReply).toContain('주가 예측해 봐');
      expect(correctedReply).toContain('현재 대상: source B');
      expect(correctedReply).toContain('요청 내용 (1번째 요청)');
      expect(correctedReply).not.toContain('현재 대상: source A');
      expect(correctedReply).not.toContain('완료했습니다');
    } finally { db.close?.(); }
  });
});

describe('supplemental second-review contracts (outside the original 24 cases)', () => {
  it.each(['리소스 목록을 raw JSON으로 보여 주세요.', '리소스 목록을 raw JSON으로 출력해줘.'])('retains affirmative raw output through real chat/service: %s', async userMessage => {
    const db = await createDatabaseAsync(':memory:');
    try {
      const model = scriptedModel([], [], 'affirmative-control');
      const generateText = vi.spyOn(model, 'generateText');
      const generateStructured = vi.spyOn(model, 'generateStructured');
      const reply = await runAxCommandChat({ harness: new AgentHarness(model), commandService: new AxCommandService(new WorkflowStore(db)),
        decisionEngine: { evaluate: async () => ({ answers: { route: selected('resource_list') } }) }, messages: [], userMessage });
      expect(reply).toContain('```json');
      expect(reply).toContain('"resources"');
      expect(generateText).not.toHaveBeenCalled();
      expect(generateStructured).not.toHaveBeenCalled();
    } finally { db.close?.(); }
  });

  it('does not authorize raw output by accepting a prefix with an unknown continuation', () => {
    for (const directive of ['리소스 raw JSON으로 보여줘', '리소스 raw JSON으로 출력해줘']) {
      for (const continuation of ['라는 표현이야', '인지 알려줘', ' "라고 하면 안 돼"']) {
        expect(explicitlyRequestsRawMetadata(`${directive}${continuation}`)).toBe(false);
      }
    }
    expect(explicitlyRequestsRawMetadata('show resources as raw JSON for resources without output')).toBe(false);
    expect(explicitlyRequestsRawMetadata('you should not show resources as raw JSON')).toBe(false);
  });

  it.each([
    { candidates: [], truncated: true, totalMatches: 1, nextOffset: 2 },
    { candidates: [], truncated: true },
  ])('keeps empty incomplete pages distinct from catalog absence: %j', data => {
    const command: AxCommand = { name: 'discovery.search', args: {} };
    const reply = deterministicMetadataChatReply(command, { command: command.name, status: 'ok', data, issues: [], inputRequests: [] }, '목록 보여줘');
    expect(reply).toContain('이번 목록');
    expect(reply).toContain('일부');
    expect(reply).not.toContain('등록된 항목이 없습니다');
  });

  it('preserves actual required/optional identifiers and named output types in readable and approved raw views', async () => {
    const db = await createDatabaseAsync(':memory:');
    try {
      const command: AxCommand = { name: 'capability.describe', args: { id: 'rdb.query.read' } };
      const result = await new AxCommandService(new WorkflowStore(db)).execute(command, { executionContext: AGENT_COMMAND_CONTEXT });
      const reply = deterministicMetadataChatReply(command, result, '입출력 스키마 보여줘');
      expect(reply).toContain('table');
      expect(reply).toContain('필수');
      expect(reply).toContain('offset');
      expect(reply).toContain('limit');
      expect(reply).toContain('선택');
      expect(reply).toContain('출력 rows: TableArtifact');
      const rawReply = deterministicMetadataChatReply(command, result, '스키마를 raw JSON으로 보여줘');
      expect(rawReply).toContain('"rows": "TableArtifact"');
      expect(rawReply).toContain('"required": true');
      expect(rawReply).toContain('"required": false');
    } finally { db.close?.(); }
  });

  it('does not display arbitrary values disguised as capability I/O contracts', async () => {
    const db = await createDatabaseAsync(':memory:');
    try {
      const command: AxCommand = { name: 'capability.describe', args: { id: 'rdb.query.read' } };
      const result = await new AxCommandService(new WorkflowStore(db)).execute(command, { executionContext: AGENT_COMMAND_CONTEXT });
      const data = JSON.parse(JSON.stringify(result.data));
      data.io.outputs.credential = 'DO_NOT_DISCLOSE';
      data.io.secret = 'DO_NOT_DISCLOSE';
      const rawReply = deterministicMetadataChatReply(command, { ...result, data }, '스키마를 raw JSON으로 보여줘');
      expect(rawReply).toContain('TableArtifact');
      expect(rawReply).not.toContain('DO_NOT_DISCLOSE');
      expect(rawReply).toContain('"truncated": true');
    } finally { db.close?.(); }
  });

  it('replaces explicitly superseded intent without reviving the old unsupported goal', async () => {
    const db = await createDatabaseAsync(':memory:');
    try {
      const coverage = { knownTotal: 1, truncated: false, overflow: false, retrievalMethod: 'configured_registry' as const };
      const catalog: MetadataCatalog = { revision: 1, policyRevision: 1, coverage, sources: [{ id: 'b', label: 'source B', revision: 1,
        aliases: [], assetId: 'asset:b', operationCoverage: { ...coverage, knownTotal: 0 }, operations: [] }] };
      const session = new RequestUnderstandingSession({ text: 'source B로 주가 예측해 봐', requestId: 'original-goal', workspaceSessionId: 'goal-session', catalog });
      const service = new AxCommandService(new WorkflowStore(db));
      const execute = vi.spyOn(service, 'execute');
      const model = scriptedModel([], [], 'intent-correction');
      const generateText = vi.spyOn(model, 'generateText');
      const generateStructured = vi.spyOn(model, 'generateStructured');
      const outcomes: RequestUnderstandingResult[] = [];
      const run = () => runAxCommandChat({ harness: new AgentHarness(model), commandService: service,
        decisionEngine: { evaluate: async () => ({ answers: { intent: selected('unsupported'), targetSourceRef: selected('source_0'), outputKind: selected('not_stated') } }) },
        requestId: session.capture().anchor.originalRequestId, workspaceSessionId: 'goal-session', requestAnchor: session.capture().anchor,
        messages: [], userMessage: session.capture().anchor.text, requestUnderstanding: { session, onResult: outcome => outcomes.push(outcome) } });
      expect(await run()).toContain('주가 예측해 봐');
      session.acceptCorrection({ text: '날씨 예측으로 바꿔줘', requestId: 'new-goal', supersedes: ['intent'] });
      const reply = await run();
      expect(reply).toContain('날씨 예측으로 바꿔줘');
      expect(reply).not.toContain('주가 예측');
      expect(outcomes.at(-1)?.stop).toBe('unsupported_intent');
      expect(outcomes.at(-1)?.assessment.provenance.fieldAuthorities.intent.requestRevision).toBe(2);
      expect(outcomes.at(-1)?.assessment.provenance.fieldAuthorities.targetSourceRef.requestRevision).toBe(1);
      expect(execute).not.toHaveBeenCalled();
      expect(generateText).not.toHaveBeenCalled();
      expect(generateStructured).not.toHaveBeenCalled();
    } finally { db.close?.(); }
  });
});
