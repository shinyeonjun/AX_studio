import { describe, expect, it } from 'vitest';
import { MAX_DECISION_CHOICE_CRITERIA, type DecisionEngine } from '../../../../contracts/decision.js';
import { availableCapabilities } from '../../../../catalog/capability-graph.js';
import { clearDynamicCatalogForTests, registerDynamicCapabilities } from '../../../../catalog/dynamic-catalog.js';
import type { ConnectorCapability } from '../../../../catalog/capability-types.js';
import { JevDecisionEngine } from '../../../decision/jev.js';
import { groupJevChoiceCandidates } from './jev-choice-grouping.js';
import { applyJevCommandInputValuesToCommand, compileJevOneShotAction } from './jev-action-catalog.js';
import { planJevWorkflow } from './jev-workflow-plan.js';

describe('planJevWorkflow', () => {
  it('groups complete choice catalogs by UTF-8 request size', () => {
    const candidates = Array.from({ length: 4 }, (_, index) => ({
      key: `candidate_${index}`,
      label: '재'.repeat(4_000),
    }));
    const groups = groupJevChoiceCandidates(
      candidates,
      'large',
      ({ key }) => key,
      ({ label }) => ({ label }),
    );

    expect(groups.map(({ candidates: group }) => group.length)).toEqual([2, 2]);
    expect(groups.flatMap(({ candidates: group }) => group.map(({ key }) => key)))
      .toEqual(candidates.map(({ key }) => key));
    for (const { candidates: group } of groups) {
      const criteria = Object.fromEntries(group.map(({ key, label }) => [key, { label }]));
      expect(new TextEncoder().encode(JSON.stringify(criteria)).byteLength).toBeLessThanOrEqual(32_770);
    }
  });

  it('lets Jev select any connected operation when the viable catalog exceeds its choice limit', async () => {
    clearDynamicCatalogForTests();
    const capabilities: ConnectorCapability[] = Array.from({ length: 260 }, (_, index) => ({
      id: `test.action_${index}`,
      connector: 'test',
      kind: 'write',
      label: `Registered action ${index}`,
      description: `Connected registered action ${index}`,
      sideEffect: 'EXTERNAL',
      params: [],
    }));
    registerDynamicCapabilities(capabilities);
    const requests: Parameters<DecisionEngine['evaluate']>[0][] = [];
    const decisionEngine: DecisionEngine = {
      evaluate: async (request) => {
        requests.push(request);
        const questionIds = Object.keys(request.questions).filter((id) =>
          id.startsWith('next_step_group_') || id.startsWith('next_step_tournament_'),
        );
        const capabilityChoice = (questionId: string, capabilityId: string): string => {
          const question = request.questions[questionId];
          if (question?.type !== 'choice') return 'none';
          return Object.entries(question.criteria).find(([, criterion]) =>
            typeof criterion === 'object' && criterion !== null
              && 'capability_id' in criterion && criterion.capability_id === capabilityId,
          )?.[0] ?? 'none';
        };
        const state = request.state as { planned_steps?: unknown[] };
        const complete = Boolean(state.planned_steps?.length);
        const answers: Record<string, unknown> = {};
        if (request.questions.plan_status) {
          answers.plan_status = {
            type: 'choice',
            choice: complete ? 'done' : 'continue',
            probabilities: { [complete ? 'done' : 'continue']: 0.5 },
            confidence: 0.5,
          };
        }
        for (const questionId of questionIds) {
          const isTournament = questionId.includes('_tournament_');
          const first = capabilityChoice(questionId, 'test.action_0');
          const last = capabilityChoice(questionId, 'test.action_259');
          const choice = complete ? 'none' : isTournament
            ? last
            : first !== 'none' ? first : last;
          const confidence = isTournament ? 0.5 : 0.99;
          answers[questionId] = {
            type: 'choice', choice,
            probabilities: { [choice]: confidence }, confidence,
          };
        }
        return { answers, requestBytes: requests.length * 100 };
      },
    };

    try {
      const result = await planJevWorkflow({
        decisionEngine,
        request: '저장소 상태를 간단히 검증해 주세요.',
        connectedConnectors: ['test'],
        readOperationHints: [],
        actionHints: capabilities.map((capability, index) => ({ key: `action_${index}`, capability })),
      });

      expect(result.kind).toBe('command');
      expect(result.telemetry.candidateCatalogMayBeBounded).toBe(false);
      expect(requests).toHaveLength(3);
      expect(result.telemetry.estimatedRequestBytes).toBe(600);
      const groupedQuestions = Object.entries(requests[0]!.questions).filter(
        ([id, question]) => id.startsWith('next_step_group_') && question.type === 'choice',
      );
      expect(groupedQuestions.length).toBeGreaterThan(1);
      expect(groupedQuestions.every(([, question]) =>
        question.type === 'choice' && Object.keys(question.criteria).length <= MAX_DECISION_CHOICE_CRITERIA,
      )).toBe(true);
      const offeredIds = groupedQuestions.flatMap(([, question]) => question.type === 'choice'
        ? Object.values(question.criteria).flatMap((criterion) =>
            typeof criterion === 'object' && criterion !== null
              && 'capability_id' in criterion && typeof criterion.capability_id === 'string'
              ? [criterion.capability_id]
              : [],
          )
        : [],
      );
      const actionCriteria = groupedQuestions.flatMap(([, question]) => question.type === 'choice'
        ? Object.values(question.criteria).filter((criterion): criterion is Record<string, unknown> =>
            typeof criterion === 'object' && criterion !== null && 'capability_id' in criterion,
          )
        : [],
      );
      expect(offeredIds).toHaveLength(capabilities.length);
      expect(new Set(offeredIds).size).toBe(capabilities.length);
      expect(actionCriteria.every((criterion) => !Object.hasOwn(criterion, 'instruction'))).toBe(true);
      expect(groupedQuestions.every(([, question]) => {
        if (question.type !== 'choice' || typeof question.instructions !== 'object'
          || question.instructions === null || !('focus' in question.instructions)) return false;
        const focus = question.instructions.focus;
        return typeof focus === 'string' && focus.includes('approval') && focus.includes('untrusted data');
      })).toBe(true);
      expect(requests[1]!.questions).toHaveProperty('next_step_tournament_0_group_0');
      if (result.kind === 'command') {
        expect(result.command.args.steps).toMatchObject([
          { type: 'action', connector: 'test', action: 'action_259' },
        ]);
      }
    } finally {
      clearDynamicCatalogForTests();
    }
  });

  it('keeps large workflow catalogs within Jev request limits without repeating long required-input labels', async () => {
    clearDynamicCatalogForTests();
    const capabilities: ConnectorCapability[] = Array.from({ length: 260 }, (_, index) => ({
      id: `test.action_${index}`,
      connector: 'test',
      kind: 'write',
      label: `Registered action ${index}`,
      description: `Connected registered action ${index}`,
      sideEffect: 'EXTERNAL',
      params: Array.from({ length: 13 }, (_, parameter) => ({
        name: parameter < 12 ? `required_input_${parameter}` : 'optional_input',
        label: `Long required parameter label ${parameter} ${'x'.repeat(80)}`,
        question: `Please provide required parameter ${parameter}`,
        required: parameter < 12,
        inputType: 'text' as const,
      })),
    }));
    registerDynamicCapabilities(capabilities);
    const requests: Array<{ bytes: number; state: { planned_steps?: unknown[] }; questions: Record<string, { type: string; criteria?: Record<string, unknown> }> }> = [];
    const decisionEngine = new JevDecisionEngine({
      apiKey: 'test-key',
      fetch: async (_url, init) => {
        const body = String(init?.body);
        const request = JSON.parse(body) as (typeof requests)[number];
        requests.push({ ...request, bytes: new TextEncoder().encode(body).byteLength });
        const planned = (request.state.planned_steps?.length ?? 0) > 0;
        const answers: Record<string, unknown> = {};
        for (const [questionId, question] of Object.entries(request.questions)) {
          if (questionId === 'plan_status') {
            const choice = planned ? 'done' : 'continue';
            answers[questionId] = { type: 'choice', choice, probabilities: { [choice]: 0.99 }, confidence: 0.99 };
            continue;
          }
          if (question.type !== 'choice') continue;
          let choice = 'none';
          if (!planned && questionId.startsWith('next_step_group_')) {
            choice = Object.entries(question.criteria ?? {}).find(([, criterion]) =>
              criterion && typeof criterion === 'object'
                && ('capability_id' in criterion)
                && (criterion.capability_id === 'test.action_0' || criterion.capability_id === 'test.action_259'),
            )?.[0] ?? 'none';
          } else if (!planned && questionId.includes('tournament')) {
            choice = Object.entries(question.criteria ?? {}).find(([, criterion]) =>
              criterion && typeof criterion === 'object'
                && 'capability_id' in criterion
                && criterion.capability_id === 'test.action_259',
            )?.[0] ?? 'none';
          }
          answers[questionId] = { type: 'choice', choice, probabilities: { [choice]: 0.99 }, confidence: 0.99 };
        }
        return new Response(JSON.stringify({ model: 'jev-latest', answers }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      },
    });

    try {
      const result = await planJevWorkflow({
        decisionEngine,
        request: '여러 작업을 진행해줘',
        connectedConnectors: ['test'],
        readOperationHints: [],
        actionHints: capabilities.map((capability, index) => ({ key: `action_${index}`, capability })),
        actionInputValues: [{
          label: 'Already supplied value',
          value: 'provided earlier',
          capabilityId: 'test.action_259',
          parameterName: 'required_input_0',
        }],
      });
      const serializedRequests = JSON.stringify(requests);
      const candidatesFor = (hasPlannedSteps: boolean) => requests
        .filter(({ state }) => ((state.planned_steps?.length ?? 0) > 0) === hasPlannedSteps)
        .flatMap(({ questions }) => Object.entries(questions)
          .filter(([id]) => id.startsWith('next_step_group_'))
          .flatMap(([, question]) => Object.values(question.criteria ?? {})
            .filter((criterion): criterion is Record<string, unknown> =>
              Boolean(criterion) && typeof criterion === 'object' && 'capability_id' in criterion,
            ),
          ),
        );

      expect(result.kind).toBe('command');
      expect(requests.length).toBeLessThan(15);
      expect(requests.every(({ bytes }) => bytes <= 65_536)).toBe(true);
      expect(candidatesFor(false).map(({ capability_id }) => capability_id)).toHaveLength(capabilities.length);
      expect(new Set(candidatesFor(false).map(({ capability_id }) => capability_id)).size).toBe(capabilities.length);
      expect(candidatesFor(true).map(({ capability_id }) => capability_id)).toHaveLength(capabilities.length);
      expect(serializedRequests).not.toContain('Long required parameter label');
      expect(serializedRequests).toContain('required_input_0');
      const selectedAction = candidatesFor(false).find(({ capability_id }) => capability_id === 'test.action_259');
      expect(selectedAction?.required_inputs).toHaveLength(11);
      expect(selectedAction?.required_inputs).not.toContain('required_input_0');
      expect(selectedAction?.required_inputs).not.toContain('optional_input');
      if (result.kind === 'command') {
        expect(result.command.args.steps).toMatchObject([
          { type: 'action', connector: 'test', action: 'action_259' },
        ]);
      }
    } finally {
      clearDynamicCatalogForTests();
    }
  });

  it.each(['conflicting-completion', 'unclear-status'] as const)(
    'clarifies grouped planner decisions with %s', async (caseName) => {
      clearDynamicCatalogForTests();
      const capabilities: ConnectorCapability[] = Array.from({ length: 260 }, (_, index) => ({
        id: `test.action_${index}`,
        connector: 'test',
        kind: 'write',
        label: `Registered action ${index}`,
        description: `Connected registered action ${index}`,
        sideEffect: 'EXTERNAL',
        params: [],
      }));
      registerDynamicCapabilities(capabilities);

      try {
        const result = await planJevWorkflow({
          decisionEngine: {
            evaluate: async (request) => {
              const groupQuestions = Object.entries(request.questions).filter(
                ([id, question]) => id.startsWith('next_step_group_') && question.type === 'choice',
              );
              const answers: Record<string, unknown> = {
                plan_status: {
                  type: 'choice',
                  choice: caseName === 'unclear-status' ? 'unclear' : 'done',
                  probabilities: { [caseName === 'unclear-status' ? 'unclear' : 'done']: 0.99 },
                  confidence: 0.99,
                },
              };
              for (const [index, [questionId, question]] of groupQuestions.entries()) {
                if (question.type !== 'choice') continue;
                const targetId = index === 0 ? 'test.action_0' : 'test.action_259';
                const targetKey = Object.entries(question.criteria).find(([, criterion]) =>
                  typeof criterion === 'object' && criterion !== null
                    && 'capability_id' in criterion && criterion.capability_id === targetId,
                )?.[0];
                const choice = caseName === 'conflicting-completion' && index === 1
                  ? 'none'
                  : targetKey ?? 'none';
                answers[questionId] = {
                  type: 'choice', choice,
                  probabilities: { [choice]: 0.99 }, confidence: 0.99,
                };
              }
              return { answers };
            },
          },
          request: '저장소 상태를 간단히 검증해 주세요.',
          connectedConnectors: ['test'],
          readOperationHints: [],
          actionHints: capabilities.map((capability, index) => ({ key: `action_${index}`, capability })),
        });

        expect(result.kind).toBe('clarify');
        expect(result.telemetry.calls).toBe(1);
      } finally {
        clearDynamicCatalogForTests();
      }
    },
  );

  it.each(['none', 'not_offered'] as const)(
    'asks for clarification when Jev chooses %s instead of an offered single-group action', async (choice) => {
      clearDynamicCatalogForTests();
      const capability: ConnectorCapability = {
        id: 'test.action', connector: 'test', kind: 'write', sideEffect: 'EXTERNAL',
        label: '등록된 작업', description: '등록된 작업', params: [],
      };
      registerDynamicCapabilities([capability]);
      let offeredNone = false;

      try {
        const result = await planJevWorkflow({
          decisionEngine: {
            evaluate: async (request) => {
              const question = request.questions.next_step;
              offeredNone = question?.type === 'choice' && Object.hasOwn(question.criteria, 'none');
              return { answers: {
                next_step: { type: 'choice', choice, probabilities: { [choice]: 0.01 }, confidence: 0.01 },
              } };
            },
          },
          request: '등록된 작업을 실행해줘.',
          connectedConnectors: ['test'],
          readOperationHints: [],
          actionHints: [{ key: 'action', capability }],
        });

        expect(result.kind).toBe('clarify');
        expect(offeredNone).toBe(true);
        expect(result.telemetry.calls).toBe(1);
      } finally {
        clearDynamicCatalogForTests();
      }
    },
  );

  it('uses Jev typed output choices without imposing a confidence cutoff', async () => {
    clearDynamicCatalogForTests();
    const firstReader: ConnectorCapability = {
      id: 'test.reader_first', connector: 'test', kind: 'read', label: '첫 자료 조회',
      description: '첫 자료 조회', params: [], io: { inputs: {}, outputs: { result: 'TableArtifact' } },
    };
    const secondReader: ConnectorCapability = {
      id: 'test.reader_second', connector: 'test', kind: 'read', label: '두 번째 자료 조회',
      description: '두 번째 자료 조회', params: [], io: { inputs: {}, outputs: { result: 'TableArtifact' } },
    };
    const writer: ConnectorCapability = {
      id: 'test.table_write', connector: 'test', kind: 'write', sideEffect: 'EXTERNAL',
      label: '표 저장', description: '표 저장', params: [],
      io: { inputs: { table: 'TableArtifact' }, outputs: {} },
    };
    registerDynamicCapabilities([firstReader, secondReader, writer]);
    let nextStepCalls = 0;
    const decisionEngine: DecisionEngine = {
      evaluate: async (request) => {
        const inputQuestion = request.questions.input_0;
        if (inputQuestion?.type === 'choice') {
          return { answers: {
            input_0: { type: 'choice', choice: 'source_1', probabilities: { source_1: 0.5 }, confidence: 0.5 },
          } };
        }

        const question = request.questions.next_step;
        if (question?.type !== 'choice') throw new Error('expected_next_step_choice');
        const state = request.state as { planned_steps?: unknown[] };
        let choice: string;
        if ((state.planned_steps?.length ?? 0) >= 3) {
          choice = 'done';
        } else {
          const capabilityId = [firstReader.id, secondReader.id, writer.id][nextStepCalls++];
          choice = Object.entries(question.criteria).find(([, criterion]) =>
            typeof criterion === 'object' && criterion !== null
              && 'capability_id' in criterion && criterion.capability_id === capabilityId,
          )?.[0] ?? 'none';
        }
        return { answers: {
          next_step: { type: 'choice', choice, probabilities: { [choice]: 0.5 }, confidence: 0.5 },
        } };
      },
    };

    try {
      const result = await planJevWorkflow({
        decisionEngine,
        request: '두 자료를 읽고 표 저장 도구로 합쳐서 저장해줘.',
        connectedConnectors: ['test'],
        readOperationHints: [firstReader, secondReader].map((capability, index) => ({
          key: `read_${index}`, capabilityId: capability.id, connector: 'test' as const,
          label: capability.label, description: capability.description, params: {},
        })),
        actionHints: [{ key: 'write', capability: writer }],
      });

      expect(result.kind).toBe('command');
      if (result.kind !== 'command') return;
      expect(result.command.args.steps).toMatchObject([
        { type: 'action', connector: 'test', action: 'reader_first' },
        { type: 'action', connector: 'test', action: 'reader_second' },
        {
          type: 'action', connector: 'test', action: 'table_write',
          bindings: { table: { from: 'jev_step_2', output: 'result' } },
        },
      ]);
    } finally {
      clearDynamicCatalogForTests();
    }
  });

  it('keeps same-capability read choices distinct by connected source', async () => {
    const readOperationHints = [
      {
        key: 'op_0', capabilityId: 'local_folder.list', connector: 'local_folder' as const,
        sourceLabel: '재무 폴더', label: '재무 폴더: 파일 목록', description: '재무 파일 조회',
        params: { folderId: 'finance-folder' },
      },
      {
        key: 'op_1', capabilityId: 'local_folder.list', connector: 'local_folder' as const,
        sourceLabel: '인사 폴더', label: '인사 폴더: 파일 목록', description: '인사 파일 조회',
        params: { folderId: 'hr-folder' },
      },
    ];
    let planningCalls = 0;
    const result = await planJevWorkflow({
      decisionEngine: {
        evaluate: async (request) => {
          planningCalls += 1;
          const question = request.questions.next_step;
          if (question?.type !== 'choice') throw new Error('Expected next-step choice');
          const state = request.state as { planned_steps?: unknown[] };
          const selected = state.planned_steps?.length
            ? 'done'
            : Object.entries(question.criteria).find(([, criterion]) =>
                typeof criterion === 'object' && criterion !== null
                  && 'label' in criterion && criterion.label === '재무 폴더: 파일 목록',
              )?.[0] ?? 'none';
          if (!state.planned_steps?.length) {
            expect(Object.values(question.criteria)).toContainEqual(expect.objectContaining({ label: '인사 폴더: 파일 목록' }));
          }
          return { answers: { next_step: {
            type: 'choice', choice: selected, probabilities: { [selected]: 0.99 }, confidence: 0.99,
          } } };
        },
      },
      request: '재무 폴더의 파일을 확인해줘',
      connectedConnectors: ['local_folder'],
      readOperationHints,
      actionHints: [],
    });

    expect(result.kind).toBe('command');
    if (result.kind !== 'command') return;
    expect(result.command.args.steps?.[0]).toMatchObject({
      connector: 'local_folder', action: 'list', params: { folderId: 'finance-folder' },
    });
    expect(planningCalls).toBe(2);
  });

  it('resolves a schema enum before adding a read step to a workflow', async () => {
    clearDynamicCatalogForTests();
    const capability: ConnectorCapability = {
      id: 'openapi.orders.listOrders', connector: 'openapi', kind: 'read',
      label: '주문 목록', description: 'GET /orders', sideEffect: 'NONE', params: [],
    };
    registerDynamicCapabilities([capability]);
    const readOperationHint = {
      key: 'op_0', capabilityId: capability.id, connector: 'openapi' as const,
      label: '주문 API: 주문 목록', description: '주문 상태별 조회', params: { query: {} },
      parameterHints: [{ path: 'query.status', type: 'string', required: true, choices: ['paid', 'pending'] }],
      missingParameterPaths: ['query.status'],
    };
    let planningCalls = 0;
    try {
      const result = await planJevWorkflow({
        decisionEngine: {
          evaluate: async (request) => {
            planningCalls += 1;
            if (request.questions.read_parameter_0?.type === 'choice') {
              expect(JSON.stringify(request.questions.read_parameter_0.criteria)).toContain('paid');
              return { answers: { read_parameter_0: {
                type: 'choice', choice: 'value_0', probabilities: { value_0: 0.99 }, confidence: 0.99,
              } } };
            }
            const question = request.questions.next_step;
            if (question?.type !== 'choice') throw new Error('Expected next-step choice');
            const state = request.state as { planned_steps?: unknown[] };
            const selected = state.planned_steps?.length
              ? 'done'
              : Object.entries(question.criteria).find(([, criterion]) =>
                  typeof criterion === 'object' && criterion !== null
                    && 'capability_id' in criterion && criterion.capability_id === capability.id,
                )?.[0] ?? 'none';
            return { answers: { next_step: {
              type: 'choice', choice: selected, probabilities: { [selected]: 0.99 }, confidence: 0.99,
            } } };
          },
        },
        request: '결제 완료된 주문을 찾아줘',
        connectedConnectors: ['openapi'],
        readOperationHints: [readOperationHint],
        actionHints: [],
      });

      expect(result.kind).toBe('command');
      if (result.kind !== 'command') return;
      expect(result.command.args.steps?.[0]).toMatchObject({
        connector: 'openapi', action: 'orders.listOrders', params: { query: { status: 'paid' } },
      });
      expect(planningCalls).toBe(3);
    } finally {
      clearDynamicCatalogForTests();
    }
  });

  it('does not plan a read step while a required schema parameter is missing', async () => {
    clearDynamicCatalogForTests();
    const capability: ConnectorCapability = {
      id: 'openapi.orders.getOrder', connector: 'openapi', kind: 'read',
      label: '주문 상세', description: 'GET /orders/{orderId}', sideEffect: 'NONE', params: [],
    };
    registerDynamicCapabilities([capability]);
    let planningCalls = 0;
    try {
      const result = await planJevWorkflow({
        decisionEngine: {
          evaluate: async (request) => {
            planningCalls += 1;
            const question = request.questions.next_step;
            if (question?.type !== 'choice') throw new Error('Expected next-step choice');
            const selected = Object.entries(question.criteria).find(([, criterion]) =>
              typeof criterion === 'object' && criterion !== null
                && 'capability_id' in criterion && criterion.capability_id === capability.id,
            )?.[0] ?? 'none';
            return { answers: { next_step: {
              type: 'choice', choice: selected, probabilities: { [selected]: 0.99 }, confidence: 0.99,
            } } };
          },
        },
        request: '주문 상세를 읽어줘',
        connectedConnectors: ['openapi'],
        readOperationHints: [{
          key: 'op_0', capabilityId: capability.id, connector: 'openapi',
          label: '주문 API: 주문 상세', description: '주문 ID로 상세 조회', params: {},
          parameterHints: [{ path: 'pathParams.orderId', type: 'string', required: true }],
          missingParameterPaths: ['pathParams.orderId'],
        }],
        actionHints: [],
      });

      expect(result).toMatchObject({ kind: 'clarify' });
      expect(result.kind === 'clarify' && result.message).toContain('pathParams.orderId');
      expect(planningCalls).toBe(1);
    } finally {
      clearDynamicCatalogForTests();
    }
  });

  it('propagates the caller cancellation signal to Jev planning', async () => {
    const gmailDraft = availableCapabilities(['gmail']).find((capability) => capability.id === 'gmail.draft.create');
    expect(gmailDraft).toBeDefined();
    const controller = new AbortController();
    let evaluationSignal: AbortSignal | undefined;
    let markEvaluating: (() => void) | undefined;
    const evaluating = new Promise<void>((resolve) => { markEvaluating = resolve; });
    const decisionEngine: DecisionEngine = {
      evaluate: async (request) => {
        evaluationSignal = request.signal;
        markEvaluating?.();
        return new Promise((_, reject) => {
          request.signal?.addEventListener('abort', () => reject(request.signal?.reason), { once: true });
        });
      },
    };

    const plan = planJevWorkflow({
      decisionEngine,
      request: 'Gmail 초안을 만들어줘',
      connectedConnectors: ['gmail'],
      readOperationHints: [],
      actionHints: [{ key: 'draft', capability: gmailDraft! }],
      signal: controller.signal,
    });
    await evaluating;
    expect(evaluationSignal).toBe(controller.signal);
    controller.abort(new Error('caller cancelled'));
    await expect(plan).rejects.toThrow('caller cancelled');
  });

  it('can generate requested text before a one-shot write without a connector data source', async () => {
    const gmailDraft = availableCapabilities(['gmail']).find((capability) => capability.id === 'gmail.draft.create');
    expect(gmailDraft).toBeDefined();
    let calls = 0;
    const decisionEngine: DecisionEngine = {
      evaluate: async (request) => {
        calls += 1;
        const question = request.questions.next_step;
        const criteria = question?.type === 'choice' ? question.criteria : {};
        const entries = Object.entries(criteria);
        const selected = calls === 1
          ? entries.find(([, value]) => typeof value === 'object' && value !== null
              && (value as { step_type?: unknown; source?: { kind?: unknown } }).step_type === 'ai_decision'
              && (value as { source?: { kind?: unknown } }).source?.kind === 'user_request')?.[0]
          : calls === 2
            ? entries.find(([, value]) => typeof value === 'object' && value !== null
                && (value as { capability_id?: unknown }).capability_id === 'gmail.draft.create')?.[0]
            : 'done';
        if (!selected) throw new Error(`missing_expected_choice_for_call_${calls}`);
        return {
          answers: {
            next_step: { type: 'choice', choice: selected, probabilities: { [selected]: 0.99 }, confidence: 0.99 },
          },
        };
      },
    };

    const result = await planJevWorkflow({
      decisionEngine,
      request: '최근 프로젝트 진행 상황을 정중하게 설명하는 메일 초안을 person@example.com에게 작성해줘',
      connectedConnectors: ['gmail'],
      readOperationHints: [],
      actionHints: [{ key: 'draft', capability: gmailDraft! }],
    });

    expect(result.kind).toBe('command');
    if (result.kind !== 'command') return;
    expect(result.command.args.steps).toMatchObject([
      {
        type: 'ai_decision', id: 'jev_step_1', investigation: false,
        goal: expect.stringContaining('사용자 요청:'),
      },
      {
        type: 'action', id: 'jev_step_2', connector: 'gmail', action: 'draft.create',
        params: { to: 'person@example.com' },
        bindings: { body: { from: 'jev_step_1', output: 'conclusion' } },
      },
    ]);
    expect(result.telemetry.calls).toBe(3);
  });

  it('uses LLM text generation in a Jev-planned one-shot read-to-draft flow', async () => {
    const gmailDraft = availableCapabilities(['gmail']).find((capability) => capability.id === 'gmail.draft.create');
    expect(gmailDraft).toBeDefined();
    let calls = 0;
    const decisionEngine: DecisionEngine = {
      evaluate: async (request) => {
        calls += 1;
        const question = request.questions.next_step;
        const criteria = question?.type === 'choice' ? question.criteria : {};
        const entries = Object.entries(criteria);
        const selected = calls === 1
          ? entries.find(([, value]) => typeof value === 'object' && value !== null
              && (value as { capability_id?: unknown }).capability_id === 'gmail.messages.search')?.[0]
          : calls === 2
            ? entries.find(([, value]) => typeof value === 'object' && value !== null
                && (value as { step_type?: unknown; source?: { output?: unknown } }).step_type === 'ai_decision'
                && (value as { source?: { output?: unknown } }).source?.output === 'messages')?.[0]
            : calls === 3
              ? entries.find(([, value]) => typeof value === 'object' && value !== null
                  && (value as { capability_id?: unknown }).capability_id === 'gmail.draft.create')?.[0]
              : 'done';
        if (!selected) throw new Error(`missing_expected_choice_for_call_${calls}`);
        return {
          answers: {
            next_step: { type: 'choice', choice: selected, probabilities: { [selected]: 0.99 }, confidence: 0.99 },
          },
        };
      },
    };

    const result = await planJevWorkflow({
      decisionEngine,
      request: '최근 메일을 찾아 핵심을 요약해 person@example.com에게 초안으로 작성해줘',
      connectedConnectors: ['gmail'],
      readOperationHints: [{
        key: 'op_0',
        capabilityId: 'gmail.messages.search',
        connector: 'gmail',
        label: 'Gmail 메일 검색',
        description: 'Gmail 메일 검색',
        params: { query: 'newer_than:7d' },
      }],
      actionHints: [{ key: 'draft', capability: gmailDraft! }],
    });

    expect(result.kind).toBe('command');
    if (result.kind !== 'command') return;
    expect(result.command.args.steps).toMatchObject([
      { type: 'action', id: 'jev_step_1', connector: 'gmail', action: 'messages.search' },
      {
        type: 'ai_decision', id: 'jev_step_2', inputContracts: { table: 'TableArtifact' },
        bindings: { table: { from: 'jev_step_1', output: 'messages' } },
      },
      {
        type: 'action', id: 'jev_step_3', connector: 'gmail', action: 'draft.create',
        params: { to: 'person@example.com' },
        bindings: { body: { from: 'jev_step_2', output: 'conclusion' } },
      },
    ]);
    expect(result.telemetry.calls).toBe(4);
  });

  it('uses an explicit quoted text input instead of also binding prior text output', async () => {
    clearDynamicCatalogForTests();
    const reader: ConnectorCapability = {
      id: 'test.text.read', connector: 'test', kind: 'read', label: '텍스트 조회',
      description: '텍스트를 조회한다', params: [], io: { inputs: {}, outputs: { text: 'TextArtifact' } },
    };
    const sender: ConnectorCapability = {
      id: 'test.text.send', connector: 'test', kind: 'write', label: '텍스트 전송',
      description: '텍스트를 전송한다', sideEffect: 'NONE',
      params: [{ name: 'body', label: '본문', question: '본문은?', required: true }],
      io: { inputs: { body: 'TextArtifact' }, outputs: {} },
    };
    registerDynamicCapabilities([reader, sender]);
    let planningCalls = 0;
    const decisionEngine: DecisionEngine = {
      evaluate: async (request) => {
        if (request.questions.action_input_0) throw new Error('single eligible field should not need another Jev call');
        planningCalls += 1;
        const question = request.questions.next_step;
        const criteria = question?.type === 'choice' ? question.criteria : {};
        const target = planningCalls === 1 ? reader.id : planningCalls === 2 ? sender.id : undefined;
        const choice = target
          ? Object.entries(criteria).find(([, criterion]) =>
              typeof criterion === 'object' && criterion !== null
                && 'capability_id' in criterion && criterion.capability_id === target,
            )?.[0] ?? 'none'
          : 'done';
        return { answers: { next_step: {
          type: 'choice', choice, probabilities: { [choice]: 0.99 }, confidence: 0.99,
        } } };
      },
    };

    try {
      const result = await planJevWorkflow({
        decisionEngine,
        request: '조회한 내용 말고 본문은 "사용자가 직접 준 본문"으로 보내줘.',
        connectedConnectors: ['test'],
        readOperationHints: [{
          key: 'read', capabilityId: reader.id, connector: 'test', label: reader.label,
          description: reader.description, params: {},
        }],
        actionHints: [{ key: 'send', capability: sender }],
      });

      expect(result.kind, result.kind === 'clarify' ? result.message : undefined).toBe('command');
      if (result.kind !== 'command') return;
      expect(result.command.args.steps).toMatchObject([
        { type: 'action', connector: 'test', action: 'text.read' },
        { type: 'action', connector: 'test', action: 'text.send', params: { body: '사용자가 직접 준 본문' } },
      ]);
      expect(result.command.args.steps?.[1]).not.toHaveProperty('bindings.body');
      expect(planningCalls).toBe(3);
      expect(result.telemetry.calls).toBe(3);
    } finally {
      clearDynamicCatalogForTests();
    }
  });

  it('compiles a direct action input against its host step and capability', () => {
    const gmailSend = availableCapabilities(['gmail']).find((capability) => capability.id === 'gmail.message.send');
    expect(gmailSend).toBeDefined();
    const command = compileJevOneShotAction(
      [{ key: 'send', capability: gmailSend! }],
      { type: 'choice', choice: 'send', confidence: 0.99 },
      '이번만 메일을 보내줘.',
      [{
        label: '수신자', value: 'person@example.com',
        stepId: 'action_1', capabilityId: 'gmail.message.send', parameterName: 'to',
      }],
    );

    expect(command?.args.steps).toMatchObject([{
      id: 'action_1',
      params: { to: 'person@example.com' },
    }]);
  });

  it('applies option-selected values to only their matching saved action steps', () => {
    const command = applyJevCommandInputValuesToCommand({
      name: 'execution.enqueue_once',
      args: {
        name: 'Slack 전송',
        goal: '이번만 Slack 메시지를 두 채널에 보내줘.',
        steps: [
          { type: 'action', id: 'jev_step_1', connector: 'slack', action: 'message.send', params: { text: '첫 메시지' } },
          { type: 'action', id: 'jev_step_2', connector: 'slack', action: 'message.send', params: { text: '둘째 메시지' } },
        ],
      },
    }, [
      {
        label: '1단계 · Slack 채널 (1)', value: 'C_FIRST',
        stepId: 'jev_step_1', capabilityId: 'slack.message.send', parameterName: 'channel',
      },
      {
        label: '2단계 · Slack 채널 (2)', value: 'C_SECOND',
        stepId: 'jev_step_2', capabilityId: 'slack.message.send', parameterName: 'channel',
      },
    ]);

    expect(command?.args.steps).toMatchObject([
      { id: 'jev_step_1', params: { channel: 'C_FIRST', text: '첫 메시지' } },
      { id: 'jev_step_2', params: { channel: 'C_SECOND', text: '둘째 메시지' } },
    ]);
  });

  it('applies host-validated schedule inputs only to the saved trigger fields', () => {
    const command = applyJevCommandInputValuesToCommand({
      name: 'job.propose',
      args: {
        name: '주중 메일 확인',
        goal: '매일 오전 9시에 Gmail 메일을 확인하는 반복 업무를 제안해줘.',
        trigger: { type: 'schedule', schedule: '', timezone: '' },
        steps: [{ type: 'action', id: 'jev_step_1', connector: 'gmail', action: 'messages.search', params: {} }],
        runOnceNow: false,
        allowExternalAuto: false,
      },
    }, [
      { label: '실행 일정 (Cron)', value: '0 9 * * 1-5', target: 'trigger', parameterName: 'schedule' },
      { label: '시간대', value: 'Asia/Seoul', target: 'trigger', parameterName: 'timezone' },
      { label: '가짜 필드', value: 'workflow.create', target: 'trigger', parameterName: 'type' },
    ]);

    expect(command?.args.trigger).toEqual({ type: 'schedule', schedule: '0 9 * * 1-5', timezone: 'Asia/Seoul' });
  });

  it('applies trigger target choices only to the saved trigger selector', () => {
    const command = applyJevCommandInputValuesToCommand({
      name: 'job.propose',
      args: {
        name: 'Slack 감시',
        goal: '운영 채널의 새 메시지를 처리한다',
        trigger: { type: 'slack.new_message', channel: '' },
        steps: [],
      },
    }, [
      { label: 'Slack 채널', value: 'C_OPS', target: 'trigger', parameterName: 'channel' },
      { label: '가짜 필드', value: 'injected', target: 'trigger', parameterName: 'unknown' },
    ]);

    expect(command?.args.trigger).toEqual({ type: 'slack.new_message', channel: 'C_OPS' });
  });

  it('applies legacy job target inputs only to the two supported destination fields', () => {
    const command = applyJevCommandInputValuesToCommand({
      name: 'job.propose',
      args: {
        name: '요약 업무',
        goal: 'API 결과를 Slack으로 공유한다',
        fetch: { method: 'GET', path: 'products' },
        notify: { connector: 'slack', skipIfEmpty: true },
      },
    }, [
      { label: 'HTTP 연결', value: 'api-b', target: 'job', parameterName: 'fetch.connectionId' },
      { label: 'Slack 채널', value: 'C_OPS', target: 'job', parameterName: 'notify.channel' },
      { label: '가짜 필드', value: 'injected', target: 'job', parameterName: 'trigger.type' },
    ]);

    expect(command?.args).toMatchObject({
      fetch: { connectionId: 'api-b', path: 'products' },
      notify: { channel: 'C_OPS', connector: 'slack' },
    });
    expect(command?.args.trigger).toBeUndefined();
  });

  it('uses Jev field choices for repeated action parameters without a confidence cutoff', async () => {
    const gmailSend = availableCapabilities(['gmail']).find((capability) => capability.id === 'gmail.message.send');
    expect(gmailSend).toBeDefined();
    let nextStepCalls = 0;
    let inputMappingCalls = 0;
    const decisionEngine: DecisionEngine = {
      evaluate: async (request) => {
        if (request.questions.action_input_0?.type === 'choice') {
          inputMappingCalls += 1;
          const body = Object.entries(request.questions.action_input_0.criteria).find(([, criterion]) =>
            typeof criterion === 'object' && criterion !== null
              && 'parameter_name' in criterion && criterion.parameter_name === 'body',
          )?.[0] ?? 'none';
          return { answers: {
            action_input_0: { type: 'choice', choice: body, probabilities: { [body]: 0.5 }, confidence: 0.5 },
          } };
        }
        nextStepCalls += 1;
        const question = request.questions.next_step;
        const sendAction = question?.type === 'choice'
          ? Object.entries(question.criteria).find(([, criterion]) =>
            typeof criterion === 'object' && criterion !== null
            && (criterion as { capability_id?: unknown }).capability_id === 'gmail.message.send')?.[0]
          : undefined;
        const choice = nextStepCalls < 3 ? sendAction ?? 'done' : 'done';
        return {
          answers: {
            next_step: {
              type: 'choice', choice,
              probabilities: { [choice]: 0.99, done: choice === 'done' ? 0.99 : 0.01 },
              confidence: 0.99,
            },
          },
        };
      },
    };

    const result = await planJevWorkflow({
      decisionEngine,
      request: '이번만 Gmail로 "같은 안내" 메일을 두 사람에게 보내줘.',
      connectedConnectors: ['gmail'],
      readOperationHints: [],
      actionHints: [{ key: 'send', capability: gmailSend! }],
      actionInputValues: [
        {
          label: '1단계 · 수신자 (1)', value: 'first@example.com',
          stepId: 'jev_step_1', capabilityId: 'gmail.message.send', parameterName: 'to',
        },
        {
          label: '2단계 · 수신자 (2)', value: 'second@example.com',
          stepId: 'jev_step_2', capabilityId: 'gmail.message.send', parameterName: 'to',
        },
      ],
    });

    expect(result.kind).toBe('command');
    if (result.kind !== 'command') return;
    expect(result.command.args.steps).toMatchObject([
      { id: 'jev_step_1', connector: 'gmail', action: 'message.send', params: { to: 'first@example.com', body: '같은 안내' } },
      { id: 'jev_step_2', connector: 'gmail', action: 'message.send', params: { to: 'second@example.com', body: '같은 안내' } },
    ]);
    expect(nextStepCalls).toBe(3);
    expect(inputMappingCalls).toBe(2);
  });
});
