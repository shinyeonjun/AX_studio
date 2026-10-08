import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DecisionAnswer, DecisionEngine, DecisionEvaluationRequest } from '../../../../../contracts/decision.js';
import type { AuthoritativeRequestFailure } from '../../../../../contracts/request-anchor.js';
import { createAuthoritativeRequestAnchor } from '../../../../decision/request-anchor.js';
import { clearDynamicCatalogForTests, registerDynamicCapabilities } from '../../../../../catalog/dynamic-catalog.js';
import type { ConnectorCapability } from '../../../../../catalog/capability-types.js';
import type { JevReadOperationHint } from '../../../../decision/read-operation-catalog.js';
import { runAxCommandChat } from '../../chat.js';
import type { AxCommandService } from '../../service.js';
import type { AxCommand, AxCommandResult } from '../../schema.js';
import { routeChatWithJev } from '../routing/router.js';
import { planJevSelectedTools } from '../planning/workflow-plan/index.js';
import { reportCommand } from '../routing/report-selection.js';
import { parallelToolAnswersForTest } from '../testing/fixtures.js';

vi.mock('../../../../../persistence/paths/app-log.js', () => ({ appendAppLog: vi.fn() }));
const choice = (value: string): DecisionAnswer => ({ type: 'choice', choice: value, probabilities: { [value]: 1 } });
const lateRequest = `Read the approved Gmail search and compose the result locally. ${'x'.repeat(2_050)}; do not send Slack or change permissions. 😀한글`;
const hint: JevReadOperationHint = { key: 'op_0', capabilityId: 'gmail.messages.search', connector: 'gmail',
  label: 'Approved search', description: 'Synthetic read only', params: { query: 'approved' },
  parameterHints: [{ path: 'limit', type: 'number', required: false, choices: [5, 10] }] };
const compose: ConnectorCapability = { id: 'test.compose', connector: 'test', kind: 'write', label: 'Compose locally',
  description: 'Synthetic local composition', sideEffect: 'REVERSIBLE',
  params: [{ name: 'note', label: 'Note', question: 'Note?', required: false },
    { name: 'comment', label: 'Comment', question: 'Comment?', required: false }],
  io: { inputs: { table: 'TableArtifact' }, outputs: {} } };
function scriptedEngine(seen: DecisionEvaluationRequest[], route = 'execution_enqueue_once'): DecisionEngine {
  return { evaluate: async (request) => {
    seen.push(request);
    const answers: Record<string, DecisionAnswer> = parallelToolAnswersForTest(request, {
      needsNaturalLanguageAnswer: route === 'answer',
      select: ({ capabilityId }) => capabilityId === 'gmail.messages.search' || capabilityId === 'test.compose',
    });
    for (const [id, q] of Object.entries(request.questions)) {
      if (q.type !== 'choice') continue;
      if (id === 'route') answers[id] = choice(route);
      else if (id === 'explicit_execution_now') answers[id] = choice('execute_now');
      else if (id === 'explicit_workflow_create') answers[id] = choice('create_now');
      else if (id === 'workflow_trigger') answers[id] = choice('manual');
      else if (id.startsWith('binding_')) answers[id] = choice('source_0');
      else if (id.includes('read_parameter') || id.startsWith('parameter_')) answers[id] = choice('value_0');
    }
    return { answers };
  } };
}
const harness = () => ({ providerName: 'synthetic', modelName: 'prose-only', runText: vi.fn(async () =>
  ({ output: 'Synthetic prose', provider: 'synthetic', durationMs: 0, promptChars: 0,
    role: 'command' as const, policy: { maxTurns: 1, timeoutMs: 1_000 }, logs: [] })) });
const commandService = () => {
  const execute = vi.fn(async (command: AxCommand, _options?: unknown): Promise<AxCommandResult> => ({ command: command.name, status: 'queued', issues: [], inputRequests: [], data: {} }));
  return { execute, service: { execute } as unknown as AxCommandService };
};
afterEach(() => clearDynamicCatalogForTests());

describe('live Jev exact-authority path', () => {
  it('preserves late negation in routing, arguments, bindings, final review and saved goals', async () => {
    registerDynamicCapabilities([compose]);
    const seen: DecisionEvaluationRequest[] = [];
    const result = await routeChatWithJev({ decisionEngine: scriptedEngine(seen), userMessage: lateRequest,
      connectedConnectors: ['gmail', 'test'], readOperationHints: [hint], connectionRevision: 7 });
    expect(result.kind).toBe('command');
    expect(seen.map(({ state }) => (state as { phase?: string }).phase).filter(Boolean))
      .toEqual(['arguments', 'bindings', 'final_review']);
    for (const packet of seen) {
      expect(packet.state).toMatchObject({ request: lateRequest, request_anchor: { decisionTextComplete: true } });
      const context = (packet.state as { context?: { request?: string } }).context;
      if (context?.request) expect(context.request).toBe(lateRequest);
    }
    expect(result.requestPlan).toMatchObject({ version: 2, request: { message: lateRequest, anchor: { text: lateRequest } } });
    if (result.kind !== 'command') throw new Error('expected command');
    expect(result.command.args).toMatchObject({ goal: lateRequest, requestAnchor: { text: lateRequest, catalogRevision: 7 } });
  });
  it('never redacts a constraint matching a pending value or appends other typed values', async () => {
    registerDynamicCapabilities([compose]); const seen: DecisionEvaluationRequest[] = []; const secret = 'SYNTHETIC_PRIVATE_TYPED_VALUE_42';
    const result = await planJevSelectedTools({ decisionEngine: scriptedEngine(seen), request: lateRequest,
      mode: 'one_shot', connectedConnectors: ['gmail', 'test'], readOperationHints: [hint],
      actionHints: [{ key: 'action_0', capability: compose }], actionInputValues: [
        { label: 'Note', value: 'do not send Slack', stepId: 'action_2', capabilityId: 'test.compose', parameterName: 'note' },
        { label: 'Comment', value: secret, stepId: 'action_2', capabilityId: 'test.compose', parameterName: 'comment' },
      ] });
    expect(result.kind).toBe('command');
    for (const packet of seen) {
      expect(packet.state).toMatchObject({ request: lateRequest }); expect(JSON.stringify(packet)).not.toContain(secret);
      expect(JSON.stringify(packet)).not.toContain('[host-confirmed input]');
    }
    if (result.kind !== 'command') throw new Error('expected command');
    expect((result.command.args.steps as { params: Record<string, unknown> }[])[1]?.params)
      .toMatchObject({ note: 'do not send Slack', comment: secret });
  });
  it('does not queue when final review rejects a late prohibition', async () => {
    registerDynamicCapabilities([compose]); const seen: DecisionEvaluationRequest[] = [];
    const engine = scriptedEngine(seen); const evaluate = engine.evaluate;
    engine.evaluate = async (request) => {
      const result = await evaluate(request);
      if (request.questions.scope) result.answers.scope = choice((request.state as { request: string }).request.includes('do not send Slack') ? 'expanded' : 'preserved');
      return result;
    };
    const host = commandService();
    const reply = await runAxCommandChat({ harness: harness(), commandService: host.service, decisionEngine: engine,
      messages: [], userMessage: lateRequest, connectedConnectors: ['gmail', 'test'], readOperationHints: [hint] });
    expect(seen.some(({ questions }) => Boolean(questions.scope))).toBe(true); expect(host.execute).not.toHaveBeenCalled();
    // The rejection explains itself and asks for specifics instead of a bare refusal.
    expect(reply).toContain('요청하지 않은 동작이나 대상이 계획에 들어갔습니다');
    expect(reply).toContain('더 구체적으로 알려주세요');
  });
  it.each(['a'.repeat(8_193), '한'.repeat(2_731)])('rejects raw overflow before decisions, catalog/read/queue/prose', async (text) => {
    const evaluate = vi.fn(async () => ({ answers: {} })); const readCatalog = vi.fn(); const model = harness(); const host = commandService();
    let failure: AuthoritativeRequestFailure | undefined;
    const reply = await runAxCommandChat({ harness: model, commandService: host.service, decisionEngine: { evaluate },
      resolveReadOperationSelection: readCatalog, messages: [], userMessage: text, onRequestRejected: (value) => { failure = value; } });
    expect(failure?.code).toBe('request_utf8_budget_exceeded'); expect(reply).toContain('한도');
    expect(evaluate).not.toHaveBeenCalled(); expect(readCatalog).not.toHaveBeenCalled();
    expect(host.execute).not.toHaveBeenCalled(); expect(model.runText).not.toHaveBeenCalled();
  });
  it('rejects escaping and first-packet overflow before decisions or execution', async () => {
    const host = commandService(); const model = harness(); const evaluate = vi.fn(async () => ({ answers: {} }));
    const failures: AuthoritativeRequestFailure[] = [];
    for (const input of [{ userMessage: 'x' + '\u0001'.repeat(3_000) }, { userMessage: 'Short request', requestBudget: { maxDecisionPacketUtf8Bytes: 128 } }]) {
      await runAxCommandChat({ harness: model, commandService: host.service, decisionEngine: { evaluate }, messages: [],
        ...input, onRequestRejected: (f) => failures.push(f) });
    }
    expect(failures.map(({ code }) => code)).toEqual(['request_serialized_budget_exceeded', 'decision_packet_budget_exceeded']);
    expect(evaluate).not.toHaveBeenCalled(); expect(host.execute).not.toHaveBeenCalled(); expect(model.runText).not.toHaveBeenCalled();
  });
  it('accepts the exact raw boundary and preserves short request behavior', async () => {
    for (const text of ['Hello', 'a'.repeat(8_192)]) {
      const seen: DecisionEvaluationRequest[] = []; const model = harness(); const host = commandService();
      const reply = await runAxCommandChat({ harness: model, commandService: host.service,
        decisionEngine: scriptedEngine(seen, 'answer'), messages: [], userMessage: text });
      expect(reply).toBe('Synthetic prose'); expect(seen).toHaveLength(1);
      expect(seen[0]?.state).toMatchObject({ request: text }); expect(host.execute).not.toHaveBeenCalled();
    }
  });
  it('keeps the complete report goal with explicitly versioned provenance', () => {
    const result = reportCommand({ hasWorkspaceSession: true, userMessage: lateRequest,
      answers: { report_source_role_0: choice('template'), report_source_role_1: choice('example') },
      candidates: ['template', 'example'].map((id) => ({ id, sessionId: 'chat', artifactId: id, fileName: `${id}.pdf`,
        status: 'ready' as const, createdAt: '', updatedAt: '' })) });
    expect(result).toMatchObject({ name: 'report.generate', args: { goal: lateRequest,
      requestAnchor: { text: lateRequest, digest: createAuthoritativeRequestAnchor(lateRequest).digest } } });
  });
  it('retains original intent/digest on pending resumption and refuses a changed tail', async () => {
    const text = `${'a'.repeat(2_050)} do not change scope`;
    const anchor = createAuthoritativeRequestAnchor(text, { originalRequestId: 'initial', workspaceSessionId: 'chat', catalogRevision: 2 });
    const pending: AxCommand = { name: 'execution.enqueue_once', args: { name: 'Pending', goal: text, requestAnchor: anchor,
      steps: [{ type: 'action', id: 'send', connector: 'gmail', action: 'message.send', params: {} }] } };
    const host = commandService(); const evaluate = vi.fn(async () => ({ answers: {} }));
    const accepted: unknown[] = []; const failures: AuthoritativeRequestFailure[] = [];
    const options = { harness: harness(), commandService: host.service, decisionEngine: { evaluate }, messages: [],
      userMessage: 'Body: PRIVATE_TYPED_ONLY', decisionMessage: text, requestAnchor: anchor, pendingCommand: pending,
      commandInputValues: [{ label: 'Body', value: 'PRIVATE_TYPED_ONLY', stepId: 'send', capabilityId: 'gmail.message.send', parameterName: 'body' }],
      requestId: 'continued', workspaceSessionId: 'chat', connectionRevision: 3,
      onRequestAnchor: (a: unknown) => accepted.push(a), onRequestRejected: (f: AuthoritativeRequestFailure) => failures.push(f) };
    await runAxCommandChat(options);
    expect(accepted[0]).toEqual(anchor); expect(host.execute).toHaveBeenCalledTimes(1);
    expect(host.execute.mock.calls[0]?.[1]).toMatchObject({ userMessage: text }); expect(evaluate).not.toHaveBeenCalled();
    host.execute.mockClear(); await runAxCommandChat({ ...options, decisionMessage: text + ' now send' });
    expect(failures[0]?.code).toBe('request_anchor_mismatch'); expect(host.execute).not.toHaveBeenCalled();
  });
});
