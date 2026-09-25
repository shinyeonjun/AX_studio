import { describe, expect, it } from 'vitest';
import type { DecisionInstruction, DecisionQuestion } from '../../../../contracts/decision.js';
import type { ConnectorCapability } from '../../../../catalog/capability-types.js';
import { JevDecisionEngine } from '../../../decision/jev.js';
import type { JevReadOperationHint } from '../../../decision/read-operation-catalog.js';
import { deriveJevRequestFeatures } from './request-features.js';
import { buildJevDecisionRequest, oneShotExecutionQuestions } from './jev-decision-request.js';
import { JEV_CHAT_ROUTE_CRITERIA } from './jev-route-criteria.js';
import { jevActionQuestionGroups } from './jev-action-catalog.js';
import { selectJevWorkflowTriggerHints } from './jev-workflow-proposal.js';
import { selectJevActionHints } from './jev-action-catalog.js';

const routeCatalog: Record<string, DecisionInstruction> = {
  answer: { what: 'Answer conversationally.' },
  context_remember: { what: 'Propose a user-confirmed memory update.' },
  capability_read: { what: 'Select a cataloged read operation.' },
};

function build(
  userMessage: string,
  httpEndpoints: readonly { id: string; label?: string; usable?: boolean }[] = [],
  hasWorkspaceSession = false,
) {
  return buildJevDecisionRequest({
    userMessage,
    requestFeatures: deriveJevRequestFeatures(userMessage),
    routeCatalog,
    hasWorkspaceSession,
    httpEndpoints,
    readOperationHints: [],
    readOperationCatalogSize: 0,
    actionSelection: { hints: [], catalogSize: 0, catalogMayBeBounded: false },
  });
}

const readOperation: JevReadOperationHint = {
  key: 'op_0',
  capabilityId: 'products.list',
  connector: 'openapi',
  label: '상품 목록',
  description: '상품 데이터를 읽습니다.',
  params: {},
};

describe('buildJevDecisionRequest', () => {
  it('keeps ordinary chat on a single answer route without mutating the route catalog', () => {
    const result = build('안녕');

    expect(result.questions).toHaveProperty('route');
    expect(Object.keys(result.questions)).toEqual(['route']);
    expect(result.routeCriteria).toEqual({ answer: routeCatalog.answer });
    expect(routeCatalog).toHaveProperty('context_remember');
    expect(routeCatalog).toHaveProperty('capability_read');
  });

  it('classifies one-shot intent beside the route before sending write-tool candidates', () => {
    const result = buildJevDecisionRequest({
      userMessage: 'Gmail로 메일을 지금 보내줘.',
      requestFeatures: {},
      routeCatalog: {
        ...routeCatalog,
        execution_enqueue_once: { what: 'Queue one connected action once.' },
      },
      readOperationHints: [],
      readOperationCatalogSize: 0,
      actionSelection: {
        hints: [{
          key: 'action_0',
          capability: {
            id: 'gmail.message.send',
            connector: 'gmail',
            kind: 'write',
            label: '메일 발송',
            description: 'Gmail 메시지를 보냅니다.',
            sideEffect: 'EXTERNAL',
            params: [],
          },
        }],
        catalogSize: 1,
        catalogMayBeBounded: false,
      },
    });

    expect(result.questions.action_scope?.type).toBe('choice');
    expect(result.questions.explicit_execution_now?.type).toBe('choice');
    expect(result.questions.explicit_execution_now?.type === 'choice'
      ? Object.keys(result.questions.explicit_execution_now.criteria)
      : []).toEqual(['execute_now', 'do_not_execute', 'unclear']);
    const executionIntent = result.questions.explicit_execution_now;
    if (executionIntent?.type !== 'choice') throw new Error('expected typed execution intent choices');
    expect(executionIntent.criteria.execute_now).toContain('draft in a connected service');
    expect(executionIntent.criteria.do_not_execute).toContain('drafted in chat');
    expect(result.questions).not.toHaveProperty('action');
  });

  it('offers the memory route based on writable scope, not memory keywords', () => {
    const result = build('앞으로 답변은 짧게 해줘.', [], true);

    expect(result.routeCriteria).toHaveProperty('context_remember');
    expect(result.questions.route?.type === 'choice'
      ? result.questions.route.criteria
      : {}).toHaveProperty('context_remember');
    expect(result.questions).not.toHaveProperty('explicit_context_update');
    expect(build('안녕', [], true).routeCriteria).toHaveProperty('context_remember');
    expect(build('앞으로 답변은 짧게 해줘.').routeCriteria).not.toHaveProperty('context_remember');
  });

  it('omits workflow-scoped routes when their required runtime context is absent', () => {
    const input = {
      userMessage: '안녕',
      requestFeatures: {},
      routeCatalog: JEV_CHAT_ROUTE_CRITERIA,
      readOperationHints: [],
      readOperationCatalogSize: 0,
      actionSelection: { hints: [], catalogSize: 0, catalogMayBeBounded: false },
    };
    const noContext = buildJevDecisionRequest(input);
    const withContext = buildJevDecisionRequest({
      ...input,
      hasWorkspaceSession: true,
      currentWorkflowId: 'workflow-current',
    });

    for (const route of ['workflow_inspect', 'workflow_validate', 'workflow_run', 'workflow_update', 'workflow_delete'] as const) {
      expect(noContext.routeCriteria).not.toHaveProperty(route);
      expect(withContext.routeCriteria).toHaveProperty(route);
    }
    expect(noContext.routeCriteria).not.toHaveProperty('session_source_list');
    expect(withContext.routeCriteria).toHaveProperty('session_source_list');
  });

  it('does not offer capability reads when there are no cataloged operations', () => {
    const result = build('상품 목록을 조회해줘.');

    expect(result.routeCriteria).not.toHaveProperty('capability_read');
    expect(result.questions).not.toHaveProperty('operation');
  });

  it('lets Jev identify a connected-data request when a bounded catalog has no local match', () => {
    const message = '재고 상태를 알려줘';
    const result = buildJevDecisionRequest({
      userMessage: message,
      requestFeatures: deriveJevRequestFeatures(message),
      routeCatalog,
      readOperationHints: [],
      readOperationCatalogSize: 64,
      actionSelection: { hints: [], catalogSize: 0, catalogMayBeBounded: false },
    });

    expect(result.routeCriteria).toHaveProperty('capability_read');
    expect(result.questions.operation?.type === 'choice' ? result.questions.operation.criteria : {})
      .toEqual({ none: expect.any(String) });
  });

  it('lets Jev choose whether to answer or use connected read operations from meaning', () => {
    const message = '요즘 매출 상황이 어떤지 궁금해.';
    const result = buildJevDecisionRequest({
      userMessage: message,
      requestFeatures: deriveJevRequestFeatures(message),
      routeCatalog,
      readOperationHints: [readOperation],
      readOperationCatalogSize: 1,
      actionSelection: { hints: [], catalogSize: 0, catalogMayBeBounded: false },
    });

    expect(result.state.request_features).toEqual({});
    expect(result.routeCriteria).toHaveProperty('capability_read');
    expect(result.questions.operation?.criteria).toMatchObject({
      none: expect.any(String),
      op_0: { label: '상품 목록', what: '상품 데이터를 읽습니다.', connector: 'openapi' },
    });
    expect(result.questions.table_transform).toMatchObject({
      type: 'choice',
      criteria: { none: expect.any(String), filter: expect.any(String), sort: expect.any(String) },
    });
    expect(result.questions.table_projection).toMatchObject({
      type: 'choice',
      criteria: { all_columns: expect.any(String), requested_columns: expect.any(String) },
    });
    expect(result.questions.read_result_style).toMatchObject({
      type: 'choice',
      criteria: { data: expect.any(String), summary: expect.any(String) },
    });
  });

  it('defers read-result questions with oversized read candidates until Jev selects the read route', () => {
    const hints = Array.from({ length: 260 }, (_, index) => ({
      ...readOperation,
      key: `op_${index}`,
    }));
    const result = buildJevDecisionRequest({
      userMessage: '안녕',
      requestFeatures: {},
      routeCatalog,
      readOperationHints: hints,
      readOperationCatalogSize: hints.length,
      deferReadOperationChoices: true,
      actionSelection: { hints: [], catalogSize: 0, catalogMayBeBounded: false },
    });

    expect(Object.keys(result.questions)).toEqual(['route']);
    expect(result.deferredReadQuestions).toHaveProperty('operation_group_0');
    expect(result.deferredReadQuestions).toHaveProperty('operation_group_1');
    expect(result.deferredReadQuestions).toHaveProperty('table_transform');
    expect(result.deferredReadQuestions).toHaveProperty('table_projection');
    expect(result.deferredReadQuestions).toHaveProperty('read_result_style');
  });

  it('keeps presentation questions in the initial request when HTTP endpoint choices are available', () => {
    const hints = Array.from({ length: 260 }, (_, index) => ({
      ...readOperation,
      key: `op_${index}`,
    }));
    const result = buildJevDecisionRequest({
      userMessage: 'GET products 를 조회해줘',
      requestFeatures: {},
      routeCatalog: { ...routeCatalog, http_read: { what: 'Read from a connected HTTP endpoint.' } },
      connectedConnectors: ['http'],
      httpEndpoints: [
        { id: 'catalog', label: 'Catalog API', usable: true },
        { id: 'inventory', label: 'Inventory API', usable: true },
      ],
      readOperationHints: hints,
      readOperationCatalogSize: hints.length,
      deferReadOperationChoices: true,
      actionSelection: { hints: [], catalogSize: 0, catalogMayBeBounded: false },
    });

    expect(result.questions).toHaveProperty('table_transform');
    expect(result.questions).toHaveProperty('table_projection');
    expect(result.questions).toHaveProperty('read_result_style');
    expect(result.questions).toHaveProperty('http_endpoint');
    expect(result.questions).not.toHaveProperty('operation_group_0');
    expect(result.deferredReadQuestions).toHaveProperty('operation_group_0');
    expect(result.deferredReadQuestions).not.toHaveProperty('table_transform');
  });

  it('keeps generated operation keys above 999 in Jev choices', () => {
    const result = buildJevDecisionRequest({
      userMessage: '상품을 조회해줘',
      requestFeatures: {},
      routeCatalog,
      readOperationHints: [{ ...readOperation, key: 'op_1000' }],
      readOperationCatalogSize: 1,
      actionSelection: { hints: [], catalogSize: 0, catalogMayBeBounded: false },
    });

    expect(result.questions.operation?.criteria).toHaveProperty('op_1000');
  });

  it('fans out oversized read metadata under Jev’s wire byte ceiling without dropping candidates', async () => {
    const hints: JevReadOperationHint[] = Array.from({ length: 254 }, (_, index) => ({
      ...readOperation,
      key: `op_${index}`,
      sourceLabel: '연결 정보'.repeat(8),
      label: '상품 카탈로그 조회'.repeat(8),
      description: '이 연결에서 사용자가 요청한 상품 카탈로그 정보를 읽어옵니다.'.repeat(12),
    }));
    const result = buildJevDecisionRequest({
      userMessage: '상품을 자연어로 찾아줘',
      requestFeatures: {},
      routeCatalog,
      readOperationHints: hints,
      readOperationCatalogSize: hints.length,
      actionSelection: { hints: [], catalogSize: 0, catalogMayBeBounded: false },
    });
    expect(result.operationGroups.length).toBeGreaterThan(1);
    expect(result.operationGroups.flatMap(({ hints: groupHints }) => groupHints.map(({ key }) => key)))
      .toEqual(hints.map(({ key }) => key));

    const sentBodies: Array<{ questions: Record<string, DecisionQuestion> }> = [];
    const decisionEngine = new JevDecisionEngine({
      apiKey: 'test-key',
      fetch: async (_url, init) => {
        const request = JSON.parse(String(init?.body)) as { questions: Record<string, DecisionQuestion> };
        sentBodies.push(request);
        const answers = Object.fromEntries(Object.entries(request.questions).map(([id, question]) => {
          if (question.type !== 'choice') throw new Error('Expected a Jev choice question.');
          const choice = Object.keys(question.criteria).find((key) => key.startsWith('op_'))!;
          return [id, { type: 'choice', choice, probabilities: { [choice]: 0.99 }, confidence: 0.99 }];
        }));
        return new Response(JSON.stringify({ answers }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      },
    });

    const evaluation = await decisionEngine.evaluate({ state: result.state, questions: result.operationQuestions });
    const transportedKeys = sentBodies.flatMap(({ questions }) => Object.values(questions)
      .flatMap((question) => question.type === 'choice'
        ? Object.keys(question.criteria).filter((key) => key.startsWith('op_'))
        : [],
      ));

    expect(sentBodies.length).toBeGreaterThan(1);
    expect(sentBodies.every((request) => new TextEncoder().encode(JSON.stringify(request)).byteLength <= 65_536)).toBe(true);
    expect(transportedKeys).toEqual(hints.map(({ key }) => key));
    expect(Object.keys(evaluation.answers)).toEqual(result.operationGroups.map(({ questionId }) => questionId));
  });

  it('offers every oversized catalog operation in Jev-sized choice groups', () => {
    const hints: JevReadOperationHint[] = Array.from({ length: 510 }, (_, index) => ({
      ...readOperation,
      key: `op_${index}`,
      capabilityId: `products.read.${index}`,
    }));
    const result = buildJevDecisionRequest({
      userMessage: '재고 상황을 알려줘',
      requestFeatures: {},
      routeCatalog,
      readOperationHints: hints,
      readOperationCatalogSize: hints.length,
      actionSelection: { hints: [], catalogSize: 0, catalogMayBeBounded: false },
    });
    const groups = result.operationGroups;
    const offeredKeys = groups.flatMap(({ hints: groupHints }) => groupHints.map(({ key }) => key));

    expect(groups.map(({ hints: groupHints }) => groupHints.length)).toEqual([254, 254, 2]);
    expect(new Set(offeredKeys).size).toBe(hints.length);
    expect(offeredKeys).toEqual(hints.map(({ key }) => key));
    for (const { questionId } of groups) {
      const question = result.questions[questionId];
      expect(question?.type).toBe('choice');
      if (question?.type === 'choice') {
        expect(Object.keys(question.criteria).length).toBeLessThanOrEqual(255);
        expect(question.criteria).toHaveProperty('none');
      }
    }
    expect(result.questions).not.toHaveProperty('operation');
  });

  it('keeps write tools out of route classification without serializing their input schemas', async () => {
    const hints = Array.from({ length: 254 }, (_, index) => ({
      key: `action_${index}`,
      capability: {
        id: `connector.write_${index}`,
        connector: 'connector',
        kind: 'write',
        label: `Connected action ${index}`,
        description: `A connected write action with enough metadata to evaluate. ${'Details '.repeat(10)}`,
        sideEffect: 'EXTERNAL',
        params: Array.from({ length: 12 }, (_, paramIndex) => ({
          name: `field_${paramIndex}`,
          label: `Required input ${paramIndex} ${'x'.repeat(80)}`,
          question: 'Required text value',
          required: true,
        })),
      } satisfies ConnectorCapability,
    }));
    const result = buildJevDecisionRequest({
      userMessage: '연결된 서비스로 이 작업을 해줘',
      requestFeatures: {},
      routeCatalog: {
        ...routeCatalog,
        execution_enqueue_once: { what: 'Queue one connected action once.' },
      },
      readOperationHints: [],
      readOperationCatalogSize: 0,
      actionSelection: { hints, catalogSize: hints.length, catalogMayBeBounded: false },
    });
    const groups = jevActionQuestionGroups(hints);
    const offeredKeys = groups.flatMap(({ hints: groupHints }) => groupHints.map(({ key }) => key));

    expect(groups.length).toBeGreaterThan(1);
    expect(offeredKeys).toEqual(hints.map(({ key }) => key));
    expect(new Set(offeredKeys).size).toBe(hints.length);
    expect(result.questions).not.toHaveProperty('action');
    expect(result.questions).toHaveProperty('action_scope');
    expect(result.questions).toHaveProperty('explicit_execution_now');

    const actionQuestions = oneShotExecutionQuestions(hints, groups);
    const actionCriterion = groups[0]?.criteria.action_0;
    expect(actionCriterion).toMatch(/^connector\.write_0 — /u);
    expect(String(actionCriterion)).not.toContain('Required input');
    expect(String(actionCriterion)).not.toContain('capability_id');
    expect(String(actionCriterion)).not.toContain('side_effect');
    for (const { questionId } of groups) {
      const question = actionQuestions[questionId];
      expect(question?.type).toBe('choice');
      if (question?.type === 'choice') {
        expect(Object.keys(question.criteria)).toContain('none');
        expect(new TextEncoder().encode(JSON.stringify(question)).byteLength).toBeLessThan(262_144);
      }
    }

    const sentBodies: Array<{ state: unknown; questions: Record<string, DecisionQuestion> }> = [];
    const requestBytes: number[] = [];
    const decisionEngine = new JevDecisionEngine({
      apiKey: 'test-key',
      fetch: async (_url, init) => {
        const body = String(init?.body);
        requestBytes.push(new TextEncoder().encode(body).byteLength);
        const request = JSON.parse(body) as (typeof sentBodies)[number];
        sentBodies.push(request);
        const answers = Object.fromEntries(Object.entries(request.questions).map(([id, question]) => [id,
          question.type === 'choice'
            ? {
                type: 'choice',
                choice: Object.keys(question.criteria)[0]!,
                probabilities: { [Object.keys(question.criteria)[0]!]: 0.99 },
                confidence: 0.99,
              }
            : { type: 'noul', noul: 0.99 },
        ]));
        return new Response(JSON.stringify({ answers }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      },
    });
    const evaluation = await decisionEngine.evaluate({ state: result.state, questions: actionQuestions });
    const transportedKeys = sentBodies.flatMap(({ questions }) => Object.entries(questions)
      .filter(([id]) => id.startsWith('action_group_'))
      .flatMap(([, question]) => question.type === 'choice'
        ? Object.keys(question.criteria).filter((key) => /^action_[0-9]+$/u.test(key))
        : [],
      ));

    expect(sentBodies).toHaveLength(1);
    expect(JSON.stringify(sentBodies)).not.toContain('Required input');
    expect(requestBytes.every((bytes) => bytes <= 65_536)).toBe(true);
    expect(transportedKeys).toEqual(hints.map(({ key }) => key));
    expect(new Set(transportedKeys).size).toBe(hints.length);
    for (const { questionId } of groups) expect(evaluation.answers).toHaveProperty(questionId);
  });

  it('offers safe connected HTTP endpoints as closed Jev choices', () => {
    const result = build('주문 데이터를 조회해줘.', [
      { id: 'billing-secret-id', label: 'Billing API', usable: true },
      { id: 'inventory-secret-id', label: 'Inventory API', usable: true },
      { id: 'disabled', label: 'Disabled API', usable: false },
    ]);

    expect(result.questions.http_endpoint).toMatchObject({
      type: 'choice',
      criteria: {
        none: expect.any(String),
        http_endpoint_0: { label: 'Billing API' },
        http_endpoint_1: { label: 'Inventory API' },
      },
    });
    expect(result.questions.http_endpoint?.type === 'choice'
      ? Object.keys(result.questions.http_endpoint.criteria)
      : []).not.toContain('http_endpoint_2');
  });

  it('does not exceed the Jev choice limit for large HTTP catalogs', () => {
    const result = build('연결된 주문 데이터를 조회해줘.', Array.from({ length: 255 }, (_, index) => ({
      id: `api-${index}`,
      label: `API ${index}`,
    })));

    expect(result.questions).not.toHaveProperty('http_endpoint');
  });

  it('classifies write intent without sending dynamic write candidates during route classification', () => {
    const userMessage = 'Gmail에 답장 초안을 부탁해';
    const result = buildJevDecisionRequest({
      userMessage,
      requestFeatures: deriveJevRequestFeatures(userMessage),
      routeCatalog: {
        ...routeCatalog,
        execution_enqueue_once: { what: 'Queue one connected action once.' },
      },
      readOperationHints: [],
      readOperationCatalogSize: 0,
      actionSelection: selectJevActionHints(['gmail']),
    });

    expect(result.state.context).toMatchObject({ connected_write_action_count: expect.any(Number) });
    expect(result.questions).toHaveProperty('explicit_execution_now');
    expect(result.questions).toHaveProperty('action_scope');
    expect(result.questions).not.toHaveProperty('action');
    expect(result.state.request_features).toEqual({});
  });

  it('asks Jev about run intent when a saved workflow is available, regardless of wording', () => {
    const message = '아까 정한 업무, 이제 진행하자.';
    const result = buildJevDecisionRequest({
      userMessage: message,
      requestFeatures: deriveJevRequestFeatures(message),
      routeCatalog,
      currentWorkflowId: 'workflow-current',
      readOperationHints: [],
      readOperationCatalogSize: 0,
      actionSelection: { hints: [], catalogSize: 0, catalogMayBeBounded: false },
    });

    expect(result.state.request_features).toEqual({});
    expect(result.questions.explicit_workflow_run).toMatchObject({
      type: 'choice',
      criteria: { run_now: expect.any(String), do_not_run: expect.any(String), unclear: expect.any(String) },
    });
    expect(build('현재 workflow를 지금 실행해줘.').questions).not.toHaveProperty('explicit_workflow_run');
  });

  it('asks Jev about workflow lifecycle intent from available context, not keyword matches', () => {
    const message = '이 내용을 다음에도 쓸 수 있게 해둘까?';
    const result = buildJevDecisionRequest({
      userMessage: message,
      requestFeatures: deriveJevRequestFeatures(message),
      routeCatalog,
      currentWorkflowId: 'workflow-current',
      hasWorkspaceSession: true,
      readOperationHints: [],
      readOperationCatalogSize: 0,
      actionSelection: { hints: [], catalogSize: 0, catalogMayBeBounded: false },
    });

    expect(result.state.request_features).toEqual({});
    expect(result.questions.explicit_workflow_create).toMatchObject({
      type: 'choice',
      criteria: { create_now: expect.any(String), do_not_create: expect.any(String), unclear: expect.any(String) },
    });
    expect(result.questions.explicit_workflow_delete).toMatchObject({
      type: 'choice',
      criteria: { delete_now: expect.any(String), do_not_delete: expect.any(String), unclear: expect.any(String) },
    });
    expect(result.questions.explicit_workflow_update).toMatchObject({
      type: 'choice',
      criteria: { update_now: expect.any(String), do_not_update: expect.any(String), unclear: expect.any(String) },
    });

    const noWorkflow = buildJevDecisionRequest({
      userMessage: message,
      requestFeatures: deriveJevRequestFeatures(message),
      routeCatalog,
      hasWorkspaceSession: true,
      readOperationHints: [],
      readOperationCatalogSize: 0,
      actionSelection: { hints: [], catalogSize: 0, catalogMayBeBounded: false },
    });
    expect(noWorkflow.questions).not.toHaveProperty('explicit_workflow_delete');
    expect(noWorkflow.questions).not.toHaveProperty('explicit_workflow_update');
    expect(build(message).questions).not.toHaveProperty('explicit_workflow_create');
  });

  it('asks Jev for a lightweight removal-intent decision without sending the step catalog', () => {
    const message = 'Slack 알림은 이제 필요 없을 것 같아.';
    const result = buildJevDecisionRequest({
      userMessage: message,
      requestFeatures: deriveJevRequestFeatures(message),
      routeCatalog,
      currentWorkflowId: 'workflow-current',
      currentWorkflowSteps: [{ id: 'notify', type: 'slack.send', label: 'Slack 알림' }],
      readOperationHints: [],
      readOperationCatalogSize: 0,
      actionSelection: { hints: [], catalogSize: 0, catalogMayBeBounded: false },
    });

    expect(result.questions.route).toBeDefined();
    expect(result.questions.explicit_workflow_step_removal).toMatchObject({
      type: 'choice',
      criteria: { remove_now: expect.any(String), do_not_remove: expect.any(String), unclear: expect.any(String) },
    });
    expect(result.questions).not.toHaveProperty('workflow_step_to_remove');
  });

  it('offers only the connected event-trigger choices for a recurring request', () => {
    const message = '새 Gmail 메일이 오면 Slack에 알려주는 반복 업무를 제안해줘.';
    const result = buildJevDecisionRequest({
      userMessage: message,
      requestFeatures: deriveJevRequestFeatures(message),
      routeCatalog,
      hasWorkspaceSession: true,
      readOperationHints: [],
      readOperationCatalogSize: 0,
      actionSelection: { hints: [], catalogSize: 0, catalogMayBeBounded: false },
      workflowTriggerHints: selectJevWorkflowTriggerHints(['gmail']),
    });

    expect(result.questions.workflow_trigger?.criteria).toMatchObject({
      none: expect.any(String),
      manual: { trigger_type: 'manual' },
    });
    const triggerChoice = Object.values(result.questions.workflow_trigger?.criteria ?? {}).find(
      (criterion) => typeof criterion === 'object' && criterion !== null
        && (criterion as { connector?: unknown }).connector === 'gmail',
    );
    expect(triggerChoice).toMatchObject({ connector: 'gmail', trigger_type: 'gmail.new_message' });
    expect(triggerChoice).not.toHaveProperty('instruction');
    expect(result.questions.workflow_trigger?.instructions).toMatchObject({
      focus: expect.stringContaining('never invent targets'),
    });
    expect(Object.values(result.questions.workflow_trigger?.criteria ?? {}).some(
      (criterion) => typeof criterion === 'object' && criterion !== null
        && (criterion as { connector?: unknown }).connector === 'slack',
    )).toBe(false);
    expect(result.questions).not.toHaveProperty('job_template');
  });

  it('lets Jev distinguish time schedules from event triggers even when none are connected', () => {
    const message = '매일 오전 9시에 반복 업무를 제안해줘.';
    const result = buildJevDecisionRequest({
      userMessage: message,
      requestFeatures: deriveJevRequestFeatures(message),
      routeCatalog,
      hasWorkspaceSession: true,
      readOperationHints: [],
      readOperationCatalogSize: 0,
      actionSelection: { hints: [], catalogSize: 0, catalogMayBeBounded: false },
    });

    expect(result.questions.workflow_trigger?.criteria).toMatchObject({
      none: expect.any(String),
      schedule: { trigger_type: 'schedule', connector: 'host_scheduler' },
    });
  });

  it('offers trigger choices to Jev for natural recurring intent without repeat keywords', () => {
    const message = '새 Gmail 메일이 오면 핵심만 Slack으로 알려줘.';
    const result = buildJevDecisionRequest({
      userMessage: message,
      requestFeatures: deriveJevRequestFeatures(message),
      routeCatalog,
      hasWorkspaceSession: true,
      readOperationHints: [],
      readOperationCatalogSize: 0,
      actionSelection: { hints: [], catalogSize: 0, catalogMayBeBounded: false },
      workflowTriggerHints: selectJevWorkflowTriggerHints(['gmail', 'slack']),
    });

    expect(result.state.request_features).toEqual({});
    expect(result.questions.workflow_trigger?.criteria).toMatchObject({
      schedule: { trigger_type: 'schedule' },
    });
    expect(Object.values(result.questions.workflow_trigger?.criteria ?? {}).some(
      (criterion) => typeof criterion === 'object' && criterion !== null
        && (criterion as { trigger_type?: unknown }).trigger_type === 'gmail.new_message',
    )).toBe(true);
  });

  it('keeps report source choices out of the initial route decision', () => {
    const message = '첨부한 양식과 예시를 참고해 이번 달 업무 결과를 정리해줘.';
    const result = buildJevDecisionRequest({
      userMessage: message,
      requestFeatures: deriveJevRequestFeatures(message),
      routeCatalog,
      readOperationHints: [],
      readOperationCatalogSize: 0,
      actionSelection: { hints: [], catalogSize: 0, catalogMayBeBounded: false },
    });

    expect(result.questions).not.toHaveProperty('report_template_source');
    expect(result.questions).not.toHaveProperty('report_example_source');
  });
});
