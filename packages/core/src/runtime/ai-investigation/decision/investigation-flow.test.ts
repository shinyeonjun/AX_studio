import { describe, expect, it, vi } from 'vitest';
import type { DecisionAnswer, DecisionEngine, DecisionEvaluationRequest } from '../../../contracts/decision.js';
import { buildTableArtifact } from '../../../contracts/artifacts/table-build.js';
import { createAgentHarness, createInvestigationRunner } from '../../../intelligence/agent/harness.js';
import { runAiDecision } from '../../ai-investigation.js';
import { parseWorkflowIR } from '../../../workflow/schema.js';
import {
  CountingProvider,
  IncompleteConclusionProvider,
  InvestigationProvider,
  decisionContext as ctx,
  decisionWorkflow as ir,
} from './fixtures.js';

type ReadChoice = 'read' | 'skip' | 'unclear';

function readAnswer(choice: ReadChoice): DecisionAnswer {
  return {
    type: 'choice', choice,
    probabilities: { read: 0.4, skip: 0.35, unclear: 0.25 },
    confidence: 0.4,
  };
}

function readAnswers(
  request: DecisionEvaluationRequest,
  choiceFor: (questionId: string) => ReadChoice = () => 'read',
): { answers: Record<string, DecisionAnswer> } {
  return {
    answers: Object.fromEntries(Object.keys(request.questions)
      .filter((questionId) => questionId.startsWith('read_'))
      .map((questionId) => [questionId, readAnswer(choiceFor(questionId))])),
  };
}



describe('runAiDecision investigation flow', () => {

  it('keeps a 255-option declared enum on Jev instead of routing it to the LLM', async () => {
    const options = Array.from({ length: 255 }, (_, index) => `category-${index}`);
    const modelCalls: string[] = [];
    const runner = {
      providerName: 'test-local',
      async run<T>(request: { outputSchema: { parse(value: unknown): T } }) {
        modelCalls.push('called');
        return { output: request.outputSchema.parse({ category: options[0] }) };
      },
    };
    const decisionEngine: DecisionEngine = {
      evaluate: vi.fn(async (request) => {
        const criteria = request.questions.output_0;
        if (criteria?.type !== 'choice') throw new Error('Expected a Jev choice question');
        const keys = Object.keys(criteria.criteria);
        expect(keys).toHaveLength(255);
        expect(criteria.criteria).not.toHaveProperty('unclear');
        const probabilities = Object.fromEntries(keys.map((key, index) => [key, index === 254 ? 0.4 : 0.6 / 254]));
        return { answers: { output_0: { type: 'choice', choice: 'option_254', probabilities } } };
      }),
    };
    const step = {
      type: 'ai_decision' as const, id: 'large_enum', goal: '유형을 분류한다', investigation: false, maxReads: 1,
      outputSchema: { type: 'object', properties: { category: { type: 'string', enum: options } }, required: ['category'] },
    };
    const results: Record<string, unknown> = {};

    await runAiDecision(step, ir, ctx, results, runner, {}, decisionEngine);

    expect(decisionEngine.evaluate).toHaveBeenCalledTimes(1);
    expect(modelCalls).toEqual([]);
    expect(results.large_enum).toMatchObject({ category: 'category-254' });
  });

  it('routes a declared numeric enum through Jev and preserves its numeric value', async () => {
    const modelCalls: string[] = [];
    const runner = {
      providerName: 'test-local',
      async run<T>(request: { outputSchema: { parse(value: unknown): T } }) {
        modelCalls.push('called');
        return { output: request.outputSchema.parse({ priority: 2 }) };
      },
    };
    const decisionEngine: DecisionEngine = {
      evaluate: vi.fn(async (request) => {
        const question = request.questions.output_0;
        if (question?.type !== 'choice') throw new Error('Expected a Jev choice question');
        expect(question.criteria).toEqual({
          option_0: { value: '1' },
          option_1: { value: '2' },
          option_2: { value: '3' },
          unclear: 'The evidence is insufficient or conflicting; do not guess.',
        });
        return {
          answers: {
            output_0: {
              type: 'choice', choice: 'option_1',
              probabilities: { option_0: 0.02, option_1: 0.96, option_2: 0.02 },
            },
          },
        };
      }),
    };
    const step = {
      type: 'ai_decision' as const, id: 'numeric_enum', goal: '우선순위를 분류한다', investigation: false, maxReads: 1,
      outputSchema: { type: 'object', properties: { priority: { type: 'number', enum: [1, 2, 3] } }, required: ['priority'] },
    };
    const results: Record<string, unknown> = {};

    await runAiDecision(step, ir, ctx, results, runner, {}, decisionEngine);

    expect(decisionEngine.evaluate).toHaveBeenCalledTimes(1);
    expect(modelCalls).toEqual([]);
    expect(results.numeric_enum).toMatchObject({ priority: 2 });
    expect(typeof (results.numeric_enum as { priority: unknown }).priority).toBe('number');
  });

  it('does not pass a closed enum beyond Jev protocol capacity to the LLM', async () => {
    const options = Array.from({ length: 256 }, (_, index) => `category-${index}`);
    const modelCalls: string[] = [];
    const runner = {
      providerName: 'test-local',
      async run<T>(request: { outputSchema: { parse(value: unknown): T } }) {
        modelCalls.push('called');
        return { output: request.outputSchema.parse({ category: options[0] }) };
      },
    };
    const decisionEngine: DecisionEngine = { evaluate: vi.fn(async () => ({ answers: {} })) };
    const step = {
      type: 'ai_decision' as const, id: 'oversized_enum', goal: '유형을 분류한다', investigation: false, maxReads: 1,
      outputSchema: { type: 'object', properties: { category: { type: 'string', enum: options } }, required: ['category'] },
    };

    await expect(runAiDecision(step, ir, ctx, {}, runner, {}, decisionEngine))
      .rejects.toMatchObject({ code: 'jev_unavailable' });

    expect(decisionEngine.evaluate).not.toHaveBeenCalled();
    expect(modelCalls).toEqual([]);
  });

  it('uses one Jev batch to classify declared enum outputs from bounded workflow evidence without an LLM call', async () => {
    const model = new InvestigationProvider();
    const table = buildTableArtifact({
      id: 'inventory', headers: ['product', 'stock'],
      matrix: [['Mascara', 4]], source: { filePath: 'C:/private/inventory.csv' },
    });
    let state: unknown;
    const decisionEngine: DecisionEngine = {
      evaluate: vi.fn(async (request) => {
        state = request.state;
        return {
          answers: {
            output_0: {
              type: 'choice', choice: 'option_0',
              probabilities: { option_0: 0.4, option_1: 0.35, option_2: 0.25 },
            },
          },
          model: 'jev-test',
          usage: { inputTokens: 100, outputTokens: 1 },
        };
      }),
    };
    const step = {
      type: 'ai_decision' as const, id: 'classify', goal: '재고 위험도를 분류한다',
      investigation: false, maxReads: 1,
      inputContracts: { inventory: 'TableArtifact' as const },
      bindings: { inventory: { from: 'read', output: 'table' } },
      outputSchema: {
        type: 'object',
        properties: { riskLevel: { type: 'string', enum: ['critical', 'normal', 'low'] } },
        required: ['riskLevel'],
      },
    };
    const workflow = {
      ...ir,
      dataPolicy: { inventory: { cloudAllowed: true } },
      steps: [
        { type: 'action' as const, id: 'read', connector: 'rdb', action: 'query', params: {}, sideEffect: 'NONE' as const },
        step,
      ],
    };
    const results: Record<string, unknown> = {};

    await runAiDecision(
      step,
      workflow,
      { executionId: 'exec-jev-classify', variables: {}, log: () => {}, outputs: { read: { table } } },
      results,
      createInvestigationRunner(createAgentHarness(model)),
      {},
      decisionEngine,
    );

    expect(decisionEngine.evaluate).toHaveBeenCalledTimes(1);
    expect(state).toMatchObject({ purpose: 'workflow_ai_decision_output' });
    expect(JSON.stringify(state)).toContain('Task: 재고 위험도를 분류한다');
    expect(JSON.stringify(state)).toContain('Mascara');
    expect(JSON.stringify(state)).not.toContain('C:/private/inventory.csv');
    expect(results.classify).toMatchObject({ riskLevel: 'critical' });
    expect(model.calls).toBe(0);
  });

  it('does not send a declared Jev-classifiable output to the LLM when Jev is unavailable', async () => {
    const model = new InvestigationProvider();
    const execute = vi.fn(async () => ({ ok: true, data: { messages: [] } }));
    const step = {
      type: 'ai_decision' as const, id: 'classify', goal: '위험도를 분류한다',
      investigation: true, maxReads: 2,
      outputSchema: {
        type: 'object',
        properties: { riskLevel: { type: 'string', enum: ['critical', 'normal', 'low'] } },
        required: ['riskLevel'],
      },
    };

    await expect(runAiDecision(
      step,
      ir,
      {
        executionId: 'exec-no-jev-output', variables: {},
        connections: [{ connector: 'gmail', connected: true, config: {} }],
        log: vi.fn(),
      },
      {},
      createInvestigationRunner(createAgentHarness(model)),
      { gmail: { name: 'gmail', execute } },
    )).rejects.toMatchObject({ code: 'jev_unavailable' });

    expect(model.calls).toBe(0);
    expect(execute).not.toHaveBeenCalled();
  });

  it('batches Jev enum and boolean outputs and asks the LLM only for prose fields', async () => {
    const parsedModelOutput: Record<string, unknown>[] = [];
    const runner = {
      providerName: 'test-local',
      async run<T>(request: { outputSchema: { parse(value: unknown): T } }) {
        const output = request.outputSchema.parse({ summary: '재고 부족', riskLevel: 'low', urgent: false });
        parsedModelOutput.push(output as Record<string, unknown>);
        return { output };
      },
    };
    const decisionEngine: DecisionEngine = {
      evaluate: vi.fn(async (request) => {
        expect(Object.keys(request.questions)).toEqual(['output_0', 'output_1']);
        return {
          answers: {
            output_0: {
              type: 'choice', choice: 'option_0',
              probabilities: { option_0: 0.96, option_1: 0.03, option_2: 0.01 },
            },
            output_1: {
              type: 'choice', choice: 'false',
              probabilities: { true: 0.35, false: 0.4, unclear: 0.25 },
            },
          },
        };
      }),
    };
    const step = {
      type: 'ai_decision' as const, id: 'mixed', goal: '재고 상태를 판단하고 요약한다',
      investigation: false, maxReads: 1,
      outputSchema: {
        type: 'object',
        properties: {
          riskLevel: { type: 'string', enum: ['critical', 'normal', 'low'] },
          urgent: { type: 'boolean' },
          summary: { type: 'string' },
        },
        required: ['riskLevel', 'urgent', 'summary'],
      },
    };
    const results: Record<string, unknown> = {};

    await runAiDecision(step, ir, ctx, results, runner, {}, decisionEngine);

    expect(decisionEngine.evaluate).toHaveBeenCalledTimes(1);
    expect(parsedModelOutput).toEqual([{ summary: '재고 부족' }]);
    expect(results.mixed).toMatchObject({ riskLevel: 'critical', urgent: false, summary: '재고 부족' });
  });

  it.each(['unclear', 'unlisted_option'])('fails closed when Jev returns %s instead of a listed value', async (choice) => {
    const model = new InvestigationProvider();
    const logs: Array<Parameters<typeof ctx.log>[0]> = [];
    const decisionContext = { ...ctx, log: (entry: Parameters<typeof ctx.log>[0]) => logs.push(entry) };
    const decisionEngine: DecisionEngine = {
      evaluate: vi.fn(async (request) => {
        expect(request.questions.output_0?.type).toBe('choice');
        if (request.questions.output_0?.type === 'choice') {
          expect(request.questions.output_0.criteria).toHaveProperty('unclear');
        }
        return { answers: {
          output_0: {
            type: 'choice', choice,
            probabilities: { [choice]: 0.4 },
          },
        } };
      }),
    };
    const step = {
      type: 'ai_decision' as const, id: 'uncertain', goal: '위험도를 분류한다',
      investigation: false, maxReads: 1,
      outputSchema: {
        type: 'object',
        properties: { riskLevel: { type: 'string', enum: ['critical', 'normal', 'low'] } },
        required: ['riskLevel'],
      },
    };

    await expect(runAiDecision(
      step, ir, decisionContext, {}, createInvestigationRunner(createAgentHarness(model)), {}, decisionEngine,
    )).rejects.toMatchObject({ code: 'ai_decision_uncertain' });

    expect(decisionEngine.evaluate).toHaveBeenCalledTimes(1);
    expect(model.calls).toBe(0);
    expect(logs).toContainEqual(expect.objectContaining({
      code: 'ai_decision_output_unclear',
      data: expect.objectContaining({ stepId: 'uncertain', field: 'riskLevel', providerRequestCount: 1 }),
    }));
  });

  it('does not follow extra reads when investigation is off', async () => {
    const model = new CountingProvider();
    const results: Record<string, unknown> = {};
    await runAiDecision(
      {
        type: 'ai_decision',
        id: 'summarize',
        goal: 'PDF 요약',
        investigation: false,
        maxReads: 4,
        outputSchema: { type: 'object', properties: { summary: { type: 'string' } } },
      },
      ir,
      ctx,
      results,
      createInvestigationRunner(createAgentHarness(model)),
      {},
    );
    expect(model.calls).toBe(1);
    expect(results.summarize).toMatchObject({ conclusion: '요약 완료' });
    expect(results.summarize).not.toHaveProperty('summary');
  });


  it('allows investigation reads before requiring declared final output fields', async () => {
    const model = new InvestigationProvider();
    const decisionEngine: DecisionEngine = {
      evaluate: vi.fn(async (request) => ({
        ...readAnswers(request),
        model: 'jev-test',
        usage: { inputTokens: 18, outputTokens: 1 },
      })),
    };
    const execute = vi.fn(async () => ({ ok: true, data: { messages: [], hits: [], limit: 10, truncated: false } }));
    const results: Record<string, unknown> = {};
    await runAiDecision(
      {
        type: 'ai_decision',
        id: 'classify',
        goal: '위험도 분류',
        investigation: true,
        maxReads: 2,
        outputSchema: {
          type: 'object',
          properties: { riskLevel: { type: 'string' } },
          required: ['riskLevel'],
        },
      },
      { ...ir, dataPolicy: { emailBody: { cloudAllowed: false } } },
      {
        executionId: 'exec-1', variables: {}, log: vi.fn(),
        connections: [{ connector: 'gmail', connected: true, config: {} }],
      },
      results,
      createInvestigationRunner(createAgentHarness(model)),
      { gmail: { name: 'gmail', execute } },
      decisionEngine,
    );

    expect(model.calls).toBe(1);
    expect(decisionEngine.evaluate).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledWith('messages.search', {}, expect.anything());
    expect(results.classify).toMatchObject({ riskLevel: 'high', needMore: false });
  });

  it('executes Jev-selected Slack search with a term parsed from natural wording', async () => {
    const model = new InvestigationProvider();
    const decisionEngine: DecisionEngine = {
      evaluate: vi.fn(async (request) => readAnswers(request)),
    };
    const execute = vi.fn(async () => ({ ok: false, error: 'offline', errorCode: 'slack_error' }));

    await runAiDecision(
      {
        type: 'ai_decision', id: 'find_inventory',
        goal: '최근 7일 동안 재고 관련 Slack 메시지를 찾아줘',
        investigation: true, maxReads: 1,
        outputSchema: { type: 'object', properties: { conclusion: { type: 'string' } } },
      },
      ir,
      {
        executionId: 'exec-slack-query', variables: {}, log: vi.fn(),
        connections: [{ connector: 'slack', connected: true, config: { token: 'never-send-to-jev' } }],
      },
      {},
      createInvestigationRunner(createAgentHarness(model)),
      { slack: { name: 'slack', execute } },
      decisionEngine,
    );

    expect(decisionEngine.evaluate).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledWith('messages.search', { query: '재고' }, expect.anything());
    expect(model.calls).toBe(1);
  });

  it('gives Jev bounded earlier read evidence when selecting the next read', async () => {
    const model = new InvestigationProvider();
    const requests: DecisionEvaluationRequest[] = [];
    const decisionEngine: DecisionEngine = {
      evaluate: vi.fn(async (request) => {
        requests.push(request);
        return readAnswers(request, (questionId) =>
          requests.length === 1 && questionId === 'read_op_0' ? 'read' : 'skip');
      }),
    };
    const gmailExecute = vi.fn(async () => ({
      ok: true,
      data: { messages: [{ id: 'message-1', subject: '재고 업데이트' }], hits: [], limit: 10, truncated: false },
    }));

    await runAiDecision(
      {
        type: 'ai_decision', id: 'inspect_inventory', goal: '재고 관련 메시지를 확인한다',
        investigation: true, maxReads: 2,
        outputSchema: { type: 'object', properties: { conclusion: { type: 'string' } } },
      },
      ir,
      {
        executionId: 'exec-adaptive-read', variables: {}, log: vi.fn(),
        connections: [
          { connector: 'gmail', connected: true, config: {} },
          { connector: 'slack', connected: true, config: {} },
        ],
      },
      {},
      createInvestigationRunner(createAgentHarness(model)),
      {
        gmail: { name: 'gmail', execute: gmailExecute },
        slack: { name: 'slack', execute: vi.fn() },
      },
      decisionEngine,
    );

    expect(decisionEngine.evaluate).toHaveBeenCalledTimes(2);
    expect(gmailExecute).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(requests[1]?.state)).toContain('재고 업데이트');
  });

  it('batches independent reads and rechecks remaining operations with collected evidence', async () => {
    const model = new InvestigationProvider();
    const decisionRequests: DecisionEvaluationRequest[] = [];
    const decisionEngine: DecisionEngine = {
      evaluate: vi.fn(async (request) => {
        decisionRequests.push(request);
        return {
          ...readAnswers(request, (questionId) => /^read_op_[1-5]$/u.test(questionId) ? 'read' : 'skip'),
          providerRequestCount: 1,
          usage: { inputTokens: 120, outputTokens: 5 },
        };
      }),
    };
    const logs: Array<{ code?: string; data?: unknown }> = [];
    const rdbExecute = vi.fn(async (_action: string, params: Record<string, unknown>) => ({
      ok: true as const,
      data: buildTableArtifact({
        id: String(params.table), name: String(params.table), headers: ['id'], matrix: [[1]],
      }),
    }));
    const workflow = parseWorkflowIR({
      ...ir,
      steps: [{
        type: 'ai_decision', id: 'inspect', goal: '연결된 업무 테이블을 조사한다', investigation: true,
        outputSchema: { type: 'object', properties: { conclusion: { type: 'string' } } },
      }],
    });
    const step = workflow.steps[0];
    if (step?.type !== 'ai_decision') throw new Error('Expected an AI decision step');

    await runAiDecision(
      step,
      workflow,
      {
        executionId: 'exec-more-than-four-reads', variables: {}, log: (entry) => logs.push(entry),
        connections: [{
          connector: 'rdb', connected: true,
          config: { allowedTables: ['orders', 'customers', 'products', 'invoices', 'payments', 'returns'] },
        }],
      },
      {},
      createInvestigationRunner(createAgentHarness(model)),
      { rdb: { name: 'rdb', execute: rdbExecute } },
      decisionEngine,
    );

    expect(step).not.toHaveProperty('maxReads');
    expect(rdbExecute).toHaveBeenCalledTimes(5);
    expect(decisionEngine.evaluate).toHaveBeenCalledTimes(2);
    expect(decisionRequests[0]!.questions.read_op_1).toMatchObject({
      type: 'choice', criteria: { read: expect.any(String), skip: expect.any(String), unclear: expect.any(String) },
    });
    expect(readAnswer('read')).toMatchObject({ confidence: 0.4, choice: 'read' });
    expect(rdbExecute.mock.calls.map(([, params]) => params.table)).toEqual([
      'orders', 'customers', 'products', 'invoices', 'payments',
    ]);
    const batchLog = logs.find((entry) => entry.code === 'ai_investigation_read_batch_selected');
    expect(batchLog?.data).toMatchObject({
      selectedCount: 5, readCount: 5, providerRequestCount: 1, inputTokens: 120, outputTokens: 5,
    });
    const completionLogs = logs.filter((entry) => entry.code === 'ai_investigation_read_completed');
    expect(completionLogs).toHaveLength(5);
    expect(completionLogs.every((entry) => !('inputTokens' in (entry.data as Record<string, unknown>)))).toBe(true);
  });

  it('honors an explicitly configured investigation read budget', async () => {
    const model = new InvestigationProvider();
    const decisionEngine: DecisionEngine = {
      evaluate: vi.fn(async (request) => readAnswers(request, (questionId) =>
        questionId === 'read_op_1' || questionId === 'read_op_2' ? 'read' : 'skip')),
    };
    const rdbExecute = vi.fn(async (_action: string, params: Record<string, unknown>) => ({
      ok: true as const,
      data: buildTableArtifact({
        id: String(params.table), name: String(params.table), headers: ['id'], matrix: [[1]],
      }),
    }));
    const workflow = parseWorkflowIR({
      ...ir,
      steps: [{
        type: 'ai_decision', id: 'budgeted_inspect', goal: '연결된 업무 테이블을 조사한다',
        investigation: true, maxReads: 2,
        outputSchema: { type: 'object', properties: { conclusion: { type: 'string' } } },
      }],
    });
    const step = workflow.steps[0];
    if (step?.type !== 'ai_decision') throw new Error('Expected an AI decision step');

    await runAiDecision(
      step,
      workflow,
      {
        executionId: 'exec-explicit-read-budget', variables: {}, log: vi.fn(),
        connections: [{
          connector: 'rdb', connected: true,
          config: { allowedTables: ['orders', 'customers', 'products', 'invoices', 'payments'] },
        }],
      },
      {},
      createInvestigationRunner(createAgentHarness(model)),
      { rdb: { name: 'rdb', execute: rdbExecute } },
      decisionEngine,
    );

    expect(step).toHaveProperty('maxReads', 2);
    expect(rdbExecute).toHaveBeenCalledTimes(2);
    expect(decisionEngine.evaluate).toHaveBeenCalledTimes(1);
  });

  it('executes independent Jev-approved reads concurrently without mutating workflow variables', async () => {
    const model = new InvestigationProvider();
    let activeReads = 0;
    let maximumConcurrentReads = 0;
    const rdbExecute = vi.fn(async (_action: string, params: Record<string, unknown>, readContext: { variables: Record<string, unknown> }) => {
      activeReads += 1;
      maximumConcurrentReads = Math.max(maximumConcurrentReads, activeReads);
      readContext.variables.queryResult = params.table;
      await Promise.resolve();
      activeReads -= 1;
      return {
        ok: true as const,
        data: buildTableArtifact({
          id: String(params.table), name: String(params.table), headers: ['id'], matrix: [[1]],
        }),
      };
    });
    const decisionEngine: DecisionEngine = {
      evaluate: vi.fn(async (request) => readAnswers(request, (questionId) =>
        questionId === 'read_op_1' || questionId === 'read_op_2' ? 'read' : 'skip')),
    };
    const step = {
      type: 'ai_decision' as const, id: 'parallel_reads', goal: 'orders와 customers 테이블을 확인한다',
      investigation: true, maxReads: 2,
      outputSchema: { type: 'object', properties: { conclusion: { type: 'string' } } },
    };
    const context = {
      executionId: 'exec-parallel-reads', variables: { queryResult: 'previous-step-value' }, log: vi.fn(),
      connections: [{ connector: 'rdb', connected: true, config: { allowedTables: ['orders', 'customers'] } }],
    };

    await runAiDecision(
      step, ir, context, {}, createInvestigationRunner(createAgentHarness(model)),
      { rdb: { name: 'rdb', execute: rdbExecute } }, decisionEngine,
    );

    expect(rdbExecute).toHaveBeenCalledTimes(2);
    expect(maximumConcurrentReads).toBe(2);
    expect(context.variables.queryResult).toBe('previous-step-value');
  });

  it('keeps successful parallel evidence and lets Jev choose an alternative after a transient read failure', async () => {
    const model = new InvestigationProvider();
    const requests: DecisionEvaluationRequest[] = [];
    const rdbExecute = vi.fn(async (_action: string, params: Record<string, unknown>) => {
      if (params.table === 'orders') {
        return { ok: false as const, error: 'temporary database outage', errorCode: 'http_error',
          errorDetails: { status: 503 } };
      }
      return {
        ok: true as const,
        data: buildTableArtifact({ id: String(params.table), name: String(params.table), headers: ['id'], matrix: [[1]] }),
      };
    });
    let evaluations = 0;
    const decisionEngine: DecisionEngine = {
      evaluate: vi.fn(async (request) => {
        requests.push(request);
        evaluations += 1;
        const selected = evaluations === 1
          ? new Set(['DB 조회: orders', 'DB 조회: customers'])
          : new Set(['DB 조회: products']);
        return {
          answers: Object.fromEntries(Object.entries(request.questions).map(([id, question]) => {
            const instructions = question.instructions;
            const operation = instructions && typeof instructions === 'object'
              ? instructions.operation as { label?: unknown } | undefined
              : undefined;
            const label = typeof operation?.label === 'string' ? operation.label : '';
            return [id, readAnswer(selected.has(label) ? 'read' : 'skip')];
          })),
        };
      }),
    };

    await runAiDecision(
      {
        type: 'ai_decision', id: 'recover_parallel_reads',
        goal: 'orders와 customers를 조회하고 products로 대체할 수 있는지 확인한다',
        investigation: true, maxReads: 3,
        outputSchema: { type: 'object', properties: { conclusion: { type: 'string' } } },
      },
      ir,
      {
        executionId: 'exec-recover-parallel-reads', variables: {}, log: vi.fn(),
        connections: [{ connector: 'rdb', connected: true,
          config: { allowedTables: ['orders', 'customers', 'products'] } }],
      },
      {}, createInvestigationRunner(createAgentHarness(model)),
      { rdb: { name: 'rdb', execute: rdbExecute } }, decisionEngine,
    );

    expect(rdbExecute.mock.calls.map(([, params]) => params.table)).toEqual(['orders', 'customers', 'products']);
    expect(decisionEngine.evaluate).toHaveBeenCalledTimes(2);
    const nextDecisionState = JSON.stringify(requests[1]?.state);
    expect(nextDecisionState).toContain('transient');
    expect(nextDecisionState).toContain('DB 조회: orders');
    expect(nextDecisionState).toContain('customers');
  });

  it('waits for sibling reads to settle before propagating a connector exception', async () => {
    const model = new InvestigationProvider();
    let siblingSettled = false;
    const rdbExecute = vi.fn(async (_action: string, params: Record<string, unknown>) => {
      if (params.table === 'orders') throw new Error('orders query failed');
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      siblingSettled = true;
      return {
        ok: true as const,
        data: buildTableArtifact({
          id: String(params.table), name: String(params.table), headers: ['id'], matrix: [[1]],
        }),
      };
    });
    const decisionEngine: DecisionEngine = {
      evaluate: vi.fn(async (request) => readAnswers(request, (questionId) =>
        questionId === 'read_op_1' || questionId === 'read_op_2' ? 'read' : 'skip')),
    };

    await expect(runAiDecision(
      {
        type: 'ai_decision', id: 'parallel_failure', goal: 'orders와 customers 테이블을 확인한다',
        investigation: true, maxReads: 2,
        outputSchema: { type: 'object', properties: { conclusion: { type: 'string' } } },
      },
      ir,
      {
        executionId: 'exec-parallel-failure', variables: {}, log: vi.fn(),
        connections: [{ connector: 'rdb', connected: true, config: { allowedTables: ['orders', 'customers'] } }],
      },
      {}, createInvestigationRunner(createAgentHarness(model)),
      { rdb: { name: 'rdb', execute: rdbExecute } }, decisionEngine,
    )).rejects.toMatchObject({
      name: 'CapabilityReadFailure',
      errorCode: 'connector_exception',
      failureKind: 'unknown',
    });

    expect(rdbExecute).toHaveBeenCalledTimes(2);
    expect(siblingSettled).toBe(true);
    expect(model.calls).toBe(0);
  });

  it.each([
    ['host-policy', { ok: false as const, error: 'table not allowed', errorCode: 'policy_denied' },
      { failureKind: 'host_policy', errorCode: 'policy_denied' }],
    ['permission', { ok: false as const, error: 'unauthorized', errorCode: 'http_error', errorDetails: { status: 401 } },
      { failureKind: 'permission_denied', errorCode: 'http_error' }],
  ] as const)('does not let Jev bypass a %s rejection by selecting another read', async (_kind, rejection, expected) => {
    const model = new InvestigationProvider();
    const rdbExecute = vi.fn(async (_action: string, params: Record<string, unknown>) => params.table === 'orders'
      ? rejection
      : { ok: true as const, data: buildTableArtifact({
          id: String(params.table), name: String(params.table), headers: ['id'], matrix: [[1]],
        }) });
    const decisionEngine: DecisionEngine = {
      evaluate: vi.fn(async (request) => {
        const selected = new Set(['DB 조회: orders', 'DB 조회: customers']);
        return {
          answers: Object.fromEntries(Object.entries(request.questions).map(([id, question]) => {
            const instructions = question.instructions;
            const operation = instructions && typeof instructions === 'object'
              ? instructions.operation as { label?: unknown } | undefined
              : undefined;
            return [id, readAnswer(typeof operation?.label === 'string' && selected.has(operation.label) ? 'read' : 'skip')];
          })),
        };
      }),
    };

    await expect(runAiDecision(
      {
        type: 'ai_decision', id: 'do_not_bypass_policy', goal: 'orders와 customers를 확인한다',
        investigation: true, maxReads: 3,
        outputSchema: { type: 'object', properties: { conclusion: { type: 'string' } } },
      },
      ir,
      {
        executionId: 'exec-no-policy-bypass', variables: {}, log: vi.fn(),
        connections: [{ connector: 'rdb', connected: true,
          config: { allowedTables: ['orders', 'customers', 'products'] } }],
      },
      {}, createInvestigationRunner(createAgentHarness(model)),
      { rdb: { name: 'rdb', execute: rdbExecute } }, decisionEngine,
    )).rejects.toMatchObject(expected);

    expect(rdbExecute).toHaveBeenCalledTimes(2);
    expect(decisionEngine.evaluate).toHaveBeenCalledTimes(1);
    expect(model.calls).toBe(0);
  });

  it('skips a candidate when Jev omits its independent read judgment', async () => {
    const model = new InvestigationProvider();
    const execute = vi.fn(async () => ({ ok: true, data: { messages: [] } }));
    const logs: Array<{ code?: string }> = [];
    const decisionEngine: DecisionEngine = { evaluate: vi.fn(async () => ({ answers: {} })) };

    await runAiDecision(
      {
        type: 'ai_decision', id: 'missing_read_answer', goal: 'Gmail 메일을 확인한다',
        investigation: true, maxReads: 1,
        outputSchema: { type: 'object', properties: { conclusion: { type: 'string' } } },
      },
      ir,
      {
        executionId: 'exec-missing-read-answer', variables: {}, log: (entry) => logs.push(entry),
        connections: [{ connector: 'gmail', connected: true, config: {} }],
      },
      {}, createInvestigationRunner(createAgentHarness(model)),
      { gmail: { name: 'gmail', execute } }, decisionEngine,
    );

    expect(execute).not.toHaveBeenCalled();
    expect(logs).toContainEqual(expect.objectContaining({ code: 'ai_investigation_jev_invalid_answer' }));
  });

  it('does not send a connector read to a cloud model when its workflow policy denies cloud transfer', async () => {
    const model = new InvestigationProvider();
    const decisionEngine: DecisionEngine = {
      evaluate: vi.fn(async (request) => readAnswers(request)),
    };
    const execute = vi.fn(async () => ({
      ok: true,
      data: { messages: [{ id: 'message-1', subject: 'PRIVATE-MAIL-SUBJECT' }], hits: [], limit: 10, truncated: false },
    }));

    await expect(runAiDecision(
      {
        type: 'ai_decision', id: 'private_mail', goal: '메일을 요약한다',
        investigation: true, maxReads: 1,
        outputSchema: { type: 'object', properties: { conclusion: { type: 'string' } } },
      },
      { ...ir, dataPolicy: { gmail: { cloudAllowed: false } } },
      {
        executionId: 'exec-private-mail', variables: {}, log: vi.fn(),
        connections: [{ connector: 'gmail', connected: true, config: {} }],
      },
      {},
      createInvestigationRunner(createAgentHarness(model)),
      { gmail: { name: 'gmail', execute } },
      decisionEngine,
    )).rejects.toMatchObject({ code: 'ai_input_unavailable' });

    expect(decisionEngine.evaluate).toHaveBeenCalledTimes(1);
    expect(model.calls).toBe(0);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('does not send cloud-denied read evidence to Jev for a declared enum decision', async () => {
    const model = new InvestigationProvider();
    const decisionEngine: DecisionEngine = {
      evaluate: vi.fn(async (request) => readAnswers(request)),
    };
    const execute = vi.fn(async () => ({
      ok: true,
      data: { messages: [{ id: 'message-1', subject: 'PRIVATE-MAIL-SUBJECT' }], hits: [], limit: 10, truncated: false },
    }));

    await expect(runAiDecision(
      {
        type: 'ai_decision', id: 'private_mail_category', goal: '메일 유형을 분류한다',
        investigation: true, maxReads: 1,
        outputSchema: {
          type: 'object',
          properties: { category: { type: 'string', enum: ['invoice', 'other'] } },
          required: ['category'],
        },
      },
      { ...ir, dataPolicy: { gmail: { cloudAllowed: false } } },
      {
        executionId: 'exec-private-mail-enum', variables: {}, log: vi.fn(),
        connections: [{ connector: 'gmail', connected: true, config: {} }],
      },
      {},
      createInvestigationRunner(createAgentHarness(model)),
      { gmail: { name: 'gmail', execute } },
      decisionEngine,
    )).rejects.toMatchObject({ code: 'ai_input_unavailable' });

    expect(decisionEngine.evaluate).toHaveBeenCalledTimes(1);
    expect(model.calls).toBe(0);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('keeps cloud-denied connector evidence available to a local model', async () => {
    let receivedEvidence: unknown;
    let receivedCloudPolicy: boolean | undefined;
    const runner = {
      providerName: 'ollama-local',
      async run<T>(request: {
        outputSchema: { parse(value: unknown): T };
        context: { evidence: unknown };
        cloudAllowed: boolean;
      }) {
        receivedEvidence = request.context.evidence;
        receivedCloudPolicy = request.cloudAllowed;
        return { output: request.outputSchema.parse({ conclusion: '로컬 분석 완료' }) };
      },
    };
    const decisionEngine: DecisionEngine = {
      evaluate: vi.fn(async (request) => readAnswers(request)),
    };
    const execute = vi.fn(async () => ({
      ok: true,
      data: { messages: [{ id: 'message-1', subject: 'LOCAL-ONLY-MAIL' }], hits: [], limit: 10, truncated: false },
    }));

    await runAiDecision(
      {
        type: 'ai_decision', id: 'local_mail_summary', goal: '메일을 요약한다',
        investigation: true, maxReads: 1,
        outputSchema: { type: 'object', properties: { conclusion: { type: 'string' } } },
      },
      { ...ir, dataPolicy: { gmail: { cloudAllowed: false } } },
      {
        executionId: 'exec-local-mail', variables: {}, log: vi.fn(),
        connections: [{ connector: 'gmail', connected: true, config: {} }],
      },
      {},
      runner,
      { gmail: { name: 'gmail', execute } },
      decisionEngine,
    );

    expect(receivedCloudPolicy).toBe(false);
    expect(JSON.stringify(receivedEvidence)).toContain('LOCAL-ONLY-MAIL');
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('does not fall back to LLM-selected reads when Jev is unavailable', async () => {
    const model = new InvestigationProvider();
    const execute = vi.fn(async () => ({ ok: true, data: { messages: [], hits: [], limit: 10, truncated: false } }));
    const logs: Array<{ code?: string }> = [];
    await runAiDecision(
      {
        type: 'ai_decision', id: 'classify', goal: '위험도 분류', investigation: true,
        maxReads: 2,
        outputSchema: { type: 'object', properties: { riskLevel: { type: 'string' } }, required: ['riskLevel'] },
      },
      ir,
      {
        executionId: 'exec-jev-unavailable', variables: {},
        connections: [{ connector: 'gmail', connected: true, config: {} }],
        log: (entry) => logs.push(entry),
      },
      {},
      createInvestigationRunner(createAgentHarness(model)),
      { gmail: { name: 'gmail', execute } },
    );

    expect(model.calls).toBe(1);
    expect(execute).not.toHaveBeenCalled();
    expect(logs).toContainEqual(expect.objectContaining({ code: 'ai_investigation_jev_unavailable' }));
  });

  it('does not execute a Jev read candidate explicitly marked unclear', async () => {
    const model = new InvestigationProvider();
    const decisionEngine: DecisionEngine = {
      evaluate: async (request) => readAnswers(request, () => 'unclear'),
    };
    const execute = vi.fn(async () => ({ ok: true, data: { messages: [], hits: [], limit: 10, truncated: false } }));
    const logs: Array<{ code?: string }> = [];
    await runAiDecision(
      {
        type: 'ai_decision', id: 'classify', goal: '위험도 분류', investigation: true,
        maxReads: 2,
        outputSchema: { type: 'object', properties: { riskLevel: { type: 'string' } }, required: ['riskLevel'] },
      },
      ir,
      {
        executionId: 'exec-jev-low-confidence', variables: {},
        connections: [{ connector: 'gmail', connected: true, config: {} }],
        log: (entry) => logs.push(entry),
      },
      {},
      createInvestigationRunner(createAgentHarness(model)),
      { gmail: { name: 'gmail', execute } },
      decisionEngine,
    );

    expect(model.calls).toBe(1);
    expect(execute).not.toHaveBeenCalled();
    expect(logs).toContainEqual(expect.objectContaining({ code: 'ai_investigation_jev_uncertain' }));
  });

  it('fails closed when Jev returns an unlisted read choice', async () => {
    const model = new InvestigationProvider();
    const invalidAnswer: DecisionAnswer = {
      type: 'choice', choice: 'inspect_anyway', probabilities: { inspect_anyway: 1 }, confidence: 1,
    };
    const decisionEngine: DecisionEngine = {
      evaluate: async (request) => ({ answers: Object.fromEntries(Object.keys(request.questions)
        .filter(questionId => questionId.startsWith('read_')).map(questionId => [questionId, invalidAnswer])) }),
    };
    const execute = vi.fn(async () => ({ ok: true, data: { messages: [], hits: [], limit: 10, truncated: false } }));
    const logs: Array<{ code?: string }> = [];
    await runAiDecision(
      {
        type: 'ai_decision', id: 'classify', goal: '위험도 분류', investigation: true,
        maxReads: 2,
        outputSchema: { type: 'object', properties: { riskLevel: { type: 'string' } }, required: ['riskLevel'] },
      },
      ir,
      {
        executionId: 'exec-jev-unlisted-read-choice', variables: {},
        connections: [{ connector: 'gmail', connected: true, config: {} }],
        log: (entry) => logs.push(entry),
      },
      {},
      createInvestigationRunner(createAgentHarness(model)),
      { gmail: { name: 'gmail', execute } },
      decisionEngine,
    );

    expect(execute).not.toHaveBeenCalled();
    expect(logs).toContainEqual(expect.objectContaining({ code: 'ai_investigation_jev_invalid_answer' }));
  });

  it('does not present a failed connector read as evidence to the LLM', async () => {
    let finalEvidence: unknown;
    const logs: Array<{ code?: string; level?: string }> = [];
    const runner = {
      providerName: 'test',
      async run<T>(request: { outputSchema: { parse(value: unknown): T }; context: { evidence: unknown } }) {
        finalEvidence = request.context.evidence;
        return { output: request.outputSchema.parse({ conclusion: '분류 완료', riskLevel: 'high' }) };
      },
    };
    const decisionEngine: DecisionEngine = {
      evaluate: async (request) => readAnswers(request),
    };
    const execute = vi.fn(async () => ({ ok: false, error: 'temporarily unavailable',
      errorCode: 'http_error', errorDetails: { status: 503 } }));
    await runAiDecision(
      {
        type: 'ai_decision', id: 'classify', goal: '위험도 분류', investigation: true,
        maxReads: 1,
        outputSchema: { type: 'object', properties: { riskLevel: { type: 'string' } }, required: ['riskLevel'] },
      },
      ir,
      {
        executionId: 'exec-failed-read', variables: {},
        connections: [{ connector: 'gmail', connected: true, config: {} }],
        log: (entry) => logs.push(entry),
      },
      {},
      runner,
      { gmail: { name: 'gmail', execute } },
      decisionEngine,
    );

    expect(finalEvidence).toEqual([]);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(logs).toContainEqual(expect.objectContaining({ code: 'ai_investigation_read_failed', level: 'warn' }));
  });


  it('repairs an incomplete terminal investigation output before storing it', async () => {
    const model = new IncompleteConclusionProvider();
    const results: Record<string, unknown> = {};
    await runAiDecision(
      {
        type: 'ai_decision',
        id: 'classify',
        goal: '위험도 분류',
        investigation: true,
        maxReads: 2,
        outputSchema: {
          type: 'object',
          properties: { riskLevel: { type: 'string' } },
          required: ['riskLevel'],
        },
      },
      { ...ir, dataPolicy: { emailBody: { cloudAllowed: false } } },
      { executionId: 'exec-1', variables: {}, log: () => {} },
      results,
      createInvestigationRunner(createAgentHarness(model)),
      {},
    );

    expect(model.calls).toBe(2);
    expect(results.classify).toMatchObject({ riskLevel: 'critical' });
  });


});
