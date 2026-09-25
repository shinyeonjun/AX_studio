import { describe, expect, it } from 'vitest';
import type { DecisionAnswer, DecisionEngine } from '../../../../contracts/decision.js';
import { clearDynamicCatalogForTests, registerDynamicCapabilities } from '../../../../catalog/dynamic-catalog.js';
import type { ConnectorCapability } from '../../../../catalog/capability-types.js';
import type { TextGenerateInput } from '../../model/provider.js';
import { createDatabaseAsync } from '../../../../persistence/db.js';
import { WorkflowStore } from '../../../../persistence/workflow-store.js';
import type { WorkflowIR } from '../../../../workflow/schema.js';
import { AgentHarness } from '../../harness.js';
import { JevDecisionEngine } from '../../../decision/jev.js';
import type { JevReadOperationHint } from '../../../decision/read-operation-catalog.js';
import type { AxCommand } from '../schema.js';
import { AxCommandService } from '../service.js';
import { runAxCommandChat } from '../chat.js';
import { scriptedModel } from './fixtures.js';
import { JEV_CHAT_ROUTE_CRITERIA } from './jev-route-criteria.js';
import { routeChatWithJev } from './jev-router.js';

const liveJevEnabled = process.env.AX_LIVE_JEV_ROUTER_TEST === '1';
const liveConnector = 'jev_live_test';

// Run with AX_LIVE_JEV_ROUTER_TEST=1 and TYPESAFE_API_KEY set. Only synthetic metadata is sent; external actions are never executed.
describe.skipIf(!liveJevEnabled)('live Jev chat router', () => {
  it('routes an oversized synthetic catalog through Jev, Desktop chat, and host validation', async () => {
    const apiKey = process.env.TYPESAFE_API_KEY?.trim();
    expect(apiKey, 'Set TYPESAFE_API_KEY to run the explicitly enabled live Jev test.').toBeTruthy();

    const capabilities: ConnectorCapability[] = Array.from({ length: 260 }, (_, index) => ({
      id: `${liveConnector}.action_${index}`,
      connector: liveConnector,
      kind: 'write',
      label: `Synthetic action ${index}`,
      description: `Synthetic one-shot integration action number ${index}. Never a real connector.`,
      sideEffect: 'EXTERNAL',
      params: [],
    }));
    clearDynamicCatalogForTests();
    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);
    store.setConnection(liveConnector, true);
    const queuedPlans: WorkflowIR[] = [];
    const service = new AxCommandService(store, {
      enqueueOnce: (workflow) => {
        queuedPlans.push(workflow);
        return { jobId: 'jev-live-test-job' };
      },
    });
    const routedCommands: AxCommand[] = [];
    const textCalls: TextGenerateInput[] = [];

    const jev = new JevDecisionEngine({
      apiKey: apiKey!,
      model: process.env.TYPESAFE_DEFAULT_MODEL?.trim() || undefined,
      baseURL: process.env.TYPESAFE_BASE_URL?.trim() || undefined,
    });
    const calls: Array<{
      durationMs: number;
      providerRequests: number;
      estimatedRequestBytes: number;
      inputTokens?: number;
      outputTokens?: number;
      questionIds: string[];
      answers: Record<string, { choice?: string; confidence?: number; probability?: number }>;
    }> = [];
    const decisionEngine: DecisionEngine = {
      async evaluate(request) {
        const startedAt = performance.now();
        const response = await jev.evaluate(request);
        calls.push({
          durationMs: Math.round(performance.now() - startedAt),
          providerRequests: response.providerRequestCount ?? 1,
          estimatedRequestBytes: new TextEncoder().encode(JSON.stringify({
            state: request.state,
            questions: request.questions,
          })).byteLength,
          ...(response.usage?.inputTokens === undefined ? {} : { inputTokens: response.usage.inputTokens }),
          ...(response.usage?.outputTokens === undefined ? {} : { outputTokens: response.usage.outputTokens }),
          questionIds: Object.keys(request.questions),
          answers: Object.fromEntries(Object.entries(response.answers).map(([id, answer]: [string, DecisionAnswer]) => [
            id,
            answer.type === 'choice'
              ? {
                  choice: answer.choice,
                  confidence: answer.confidence,
                  probability: answer.probabilities[answer.choice],
                }
              : answer.type === 'boolean'
                ? { probability: answer.probability }
                : { confidence: answer.confidence },
          ])),
        });
        return response;
      },
    };

    const startedAt = performance.now();
    try {
      registerDynamicCapabilities(capabilities);
      const reply = await runAxCommandChat({
        harness: new AgentHarness(scriptedModel([], [], 'live-test-provider', [], textCalls)),
        commandService: service,
        decisionEngine,
        connectedConnectors: [liveConnector],
        messages: [],
        userMessage: '연결된 도구 중 이름이 "Synthetic action 259"인 작업을 일회성으로 지금 실행해줘. 정확히 그 작업을 선택해.',
        onCommandResult: (_result, command) => {
          if (command) routedCommands.push(command);
        },
      });
      const elapsedMs = Math.round(performance.now() - startedAt);
      const command = routedCommands.find(({ name }) => name === 'execution.enqueue_once');
      const queuedPlan = queuedPlans[0];
      const queuedAction = queuedPlan?.steps[0];
      const selected = queuedAction?.type === 'action' ? queuedAction : undefined;
      const selectedCandidates = calls.flatMap((call) => Object.entries(call.answers)
        .filter(([questionId]) => questionId.startsWith('action_group_')
          || questionId.startsWith('action_tournament_'))
        .map(([, answer]) => answer.choice)
        .filter((choice): choice is string => Boolean(choice && choice !== 'none')));

      console.info('[live Jev router]', JSON.stringify({
        elapsedMs,
        reply,
        route: calls[0]?.answers.route?.choice,
        routeConfidence: calls[0]?.answers.route?.confidence,
        actionScopeChoice: calls[0]?.answers.action_scope?.choice,
        actionScopeConfidence: calls[0]?.answers.action_scope?.confidence,
        actionCandidateSelected: selectedCandidates.length > 0,
        actionCandidateConfidence: calls.flatMap((call) => Object.entries(call.answers)
          .filter(([questionId]) => questionId.startsWith('action_group_')
            || questionId.startsWith('action_tournament_'))
          .map(([, answer]) => answer.confidence ?? 0))[0],
        selectedConnector: selected?.connector,
        selectedAction: selected?.action,
        selectedCandidates,
        catalogSize: capabilities.length,
        decisionCalls: calls.length,
        providerRequests: calls.reduce((sum, call) => sum + call.providerRequests, 0),
        estimatedRequestBytes: calls.reduce((sum, call) => sum + call.estimatedRequestBytes, 0),
        inputTokens: calls.reduce((sum, call) => sum + (call.inputTokens ?? 0), 0),
        outputTokens: calls.reduce((sum, call) => sum + (call.outputTokens ?? 0), 0),
        calls,
        validatedAndQueuedToTestStub: queuedPlans.length === 1,
        externalActionExecuted: false,
      }));

      expect(reply).toContain('큐에 등록');
      expect(command).toMatchObject({ name: 'execution.enqueue_once' });
      expect(queuedPlans).toHaveLength(1);
      expect(queuedPlan?.allowExternalAuto).toBe(false);
      expect(selected).toMatchObject({
        connector: liveConnector,
        action: 'action_259',
        sideEffect: 'EXTERNAL',
      });
      expect(store.listWorkflows()).toHaveLength(0);
      expect(calls[0]?.answers.route?.choice).toBe('execution_enqueue_once');
      expect(calls[0]?.answers.action_scope?.choice).toBe('single_action');
      expect(selectedCandidates).toContain('action_259');
      expect(calls.length).toBeGreaterThanOrEqual(2);
      expect(calls.reduce((sum, call) => sum + call.providerRequests, 0)).toBe(calls.length);
      expect(textCalls).toHaveLength(0);
    } finally {
      clearDynamicCatalogForTests();
      db.close();
    }
  }, 120_000);

  it('measures live request cost when a casual greeting carries an oversized read catalog', async () => {
    const apiKey = process.env.TYPESAFE_API_KEY?.trim();
    expect(apiKey, 'Set TYPESAFE_API_KEY to run the explicitly enabled live Jev test.').toBeTruthy();

    const readOperationHints: JevReadOperationHint[] = Array.from({ length: 260 }, (_, index) => ({
      key: `op_${index}`,
      capabilityId: `rdb.query.read.synthetic_${index}`,
      connector: 'rdb',
      sourceLabel: `Synthetic database ${index}`,
      label: `Synthetic table ${index}`,
      description: `Read rows from synthetic table ${index}; metadata only, not a real database.`,
      params: {},
    }));
    const jev = new JevDecisionEngine({
      apiKey: apiKey!,
      model: process.env.TYPESAFE_DEFAULT_MODEL?.trim() || undefined,
      baseURL: process.env.TYPESAFE_BASE_URL?.trim() || undefined,
    });
    const calls: Array<{
      durationMs: number;
      providerRequests: number;
      requestBytes?: number;
      questionIds: string[];
      inputTokens?: number;
      outputTokens?: number;
    }> = [];
    let initialRequest: Parameters<DecisionEngine['evaluate']>[0] | undefined;
    const decisionEngine: DecisionEngine = {
      async evaluate(request) {
        initialRequest ??= request;
        const startedAt = performance.now();
        const response = await jev.evaluate(request);
        calls.push({
          durationMs: Math.round(performance.now() - startedAt),
          providerRequests: response.providerRequestCount ?? 1,
          ...(response.requestBytes === undefined ? {} : { requestBytes: response.requestBytes }),
          questionIds: Object.keys(request.questions),
          ...(response.usage?.inputTokens === undefined ? {} : { inputTokens: response.usage.inputTokens }),
          ...(response.usage?.outputTokens === undefined ? {} : { outputTokens: response.usage.outputTokens }),
        });
        return response;
      },
    };

    const startedAt = performance.now();
    const result = await routeChatWithJev({
      decisionEngine,
      userMessage: '안녕',
      hasWorkspaceSession: true,
      readOperationHints,
      readOperationCatalogSize: readOperationHints.length,
      readOperationSelectionMode: 'no_lexical_match',
    });
    const elapsedMs = Math.round(performance.now() - startedAt);
    const telemetry = result.telemetry;

    const routeQuestion = initialRequest?.questions.route;
    if (!initialRequest || routeQuestion?.type !== 'choice') {
      throw new Error('Expected a captured Jev route choice for the live request comparison.');
    }
    const baseline = await jev.evaluate({
      state: initialRequest.state,
      questions: {
        ...initialRequest.questions,
        route: {
          ...routeQuestion,
          criteria: {
            ...routeQuestion.criteria,
            workflow_inspect: JEV_CHAT_ROUTE_CRITERIA.workflow_inspect,
            workflow_validate: JEV_CHAT_ROUTE_CRITERIA.workflow_validate,
            workflow_run: JEV_CHAT_ROUTE_CRITERIA.workflow_run,
            workflow_update: JEV_CHAT_ROUTE_CRITERIA.workflow_update,
            workflow_delete: JEV_CHAT_ROUTE_CRITERIA.workflow_delete,
          },
        },
      },
    });

    console.info('[live Jev route catalog A/B]', JSON.stringify({
      current: {
        routeChoices: Object.keys(routeQuestion.criteria).length,
        requestBytes: calls[0]?.requestBytes,
        inputTokens: calls[0]?.inputTokens,
        outputTokens: calls[0]?.outputTokens,
      },
      restoredUnavailableRoutes: {
        routeChoices: Object.keys(routeQuestion.criteria).length + 5,
        requestBytes: baseline.requestBytes,
        inputTokens: baseline.usage?.inputTokens,
        outputTokens: baseline.usage?.outputTokens,
      },
      externalActionExecuted: false,
    }));

    console.info('[live Jev read-catalog overhead]', JSON.stringify({
      elapsedMs,
      result: result.kind,
      selectedRoute: telemetry?.selectedRoute,
      catalogSize: telemetry?.operationCatalogSize,
      operationCandidateCount: telemetry?.operationCandidateCount,
      estimatedRequestBytes: telemetry?.estimatedRequestBytes,
      inputTokens: telemetry?.inputTokens,
      outputTokens: telemetry?.outputTokens,
      evaluationCalls: telemetry?.evaluationCalls,
      providerRequests: telemetry?.providerRequestCount,
      calls,
      executed: false,
    }));

    expect(result.kind).not.toBe('command');
    expect(telemetry?.operationCatalogSize).toBe(260);
    expect(telemetry?.operationCandidateCount).toBe(0);
    expect(calls[0]?.questionIds).toEqual(['route', 'workflow_trigger', 'explicit_workflow_create']);
    expect(telemetry?.questionIds).toEqual(['route', 'workflow_trigger', 'explicit_workflow_create']);
    expect(telemetry?.estimatedRequestBytes).toBeGreaterThan(0);
    expect(baseline.requestBytes).toBeGreaterThan(calls[0]?.requestBytes ?? 0);
  }, 120_000);
});
