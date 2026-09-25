import { describe, expect, it, vi } from 'vitest';
import { createDatabaseAsync } from '../../../persistence/db.js';
import { WorkflowStore } from '../../../persistence/workflow-store.js';
import { WorkflowRuntime } from '../../engine.js';
import type { WorkflowIR } from '../../../workflow/schema.js';
import type { DecisionEngine } from '../../../contracts/decision.js';
import type { InvestigationRunRequest, InvestigationRunner } from '../../../intelligence/agent/investigation-runner.js';
import { createTestConnectors, mockSlack } from '../../../testing/connectors/test-connectors.js';

describe('runtime control-flow nested risk branch', () => {
  it('executes one destination in a three-level risk branch and binds the declared result', async () => {
    const ir: WorkflowIR = {
      name: '위험도 분기 알림',
      goal: '위험도별로 정확히 한 채널에 알림',
      version: 1,
      trigger: { type: 'manual' },
      steps: [
        {
          type: 'ai_decision',
          id: 'classify',
          goal: '문서를 critical, high, normal 중 하나로 분류',
          outputSchema: {
            type: 'object',
            properties: { riskLevel: { type: 'string', enum: ['critical', 'high', 'normal'] } },
            required: ['riskLevel'],
          },
          investigation: false,
          maxReads: 1,
        },
        {
          type: 'if',
          id: 'if_critical',
          condition: { op: 'eq', left: { ref: 'classify.riskLevel' }, right: { lit: 'critical' } },
          thenStepIds: ['critical_notify'],
          elseStepIds: ['if_high'],
        },
        {
          type: 'if',
          id: 'if_high',
          condition: { op: 'eq', left: { ref: 'classify.riskLevel' }, right: { lit: 'high' } },
          thenStepIds: ['high_notify'],
          elseStepIds: ['normal_notify'],
        },
        ...(['critical', 'high', 'normal'] as const).map((riskLevel) => ({
          type: 'action' as const,
          id: `${riskLevel}_notify`,
          connector: 'slack',
          action: 'message.send',
          params: { channel: `#${riskLevel}` },
          bindings: { text: { from: 'classify', output: 'riskLevel' } },
          sideEffect: 'EXTERNAL' as const,
        })),
      ],
      permissions: {},
      approval: [],
      allowExternalAuto: true,
      assumptions: [],
      sideEffects: {},
      dataPolicy: {},
    };

    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);
    const decisionEngine: DecisionEngine = {
      async evaluate({ questions }) {
        const question = questions.output_0;
        if (question?.type !== 'choice') throw new Error('Expected the declared risk classification options');
        const selected = Object.entries(question.criteria)
          .find(([, criterion]) => criterion !== null && typeof criterion === 'object'
            && 'value' in criterion && criterion.value === 'normal')?.[0];
        if (!selected) throw new Error('Expected the normal risk option');
        return {
          answers: {
            output_0: {
              type: 'choice', choice: selected,
              probabilities: Object.fromEntries(Object.keys(question.criteria).map((key) => [key, key === selected ? 0.96 : 0.02])),
            },
          },
          model: 'jev-test',
        };
      },
    };
    const runtime = new WorkflowRuntime({
      store,
      globalActive: true,
      workflowActive: {},
      connectors: createTestConnectors(),
      decisionEngine,
    });

    const result = await runtime.executeWorkflow(ir, { ephemeral: true });

    expect(result.status).toBe('success');
    expect(mockSlack(runtime.connectors).messages).toEqual([{ channel: '#normal', text: 'normal' }]);
    const persistedLog = JSON.parse(store.getExecution(result.executionId)?.logJson ?? '[]') as Array<{
      code?: string;
      data?: { outputPreview?: Record<string, string> };
    }>;
    expect(persistedLog.find((entry) => entry.code === 'ai_decision_completed')?.data?.outputPreview)
      .toMatchObject({ riskLevel: 'normal' });
  });

  it('rejects an unconstrained AI output used by a branch before calling models or actions', async () => {
    const ir: WorkflowIR = {
      name: '자유형 분기 차단',
      goal: '분기 출력 계약 확인',
      version: 1,
      trigger: { type: 'manual' },
      steps: [
        {
          type: 'ai_decision',
          id: 'classify',
          goal: '문서를 분류',
          outputSchema: {
            type: 'object',
            properties: { riskLevel: { type: 'string' } },
            required: ['riskLevel'],
          },
          investigation: false,
          maxReads: 1,
        },
        {
          type: 'if',
          id: 'if_critical',
          condition: { op: 'eq', left: { ref: 'classify.riskLevel' }, right: { lit: 'critical' } },
          thenStepIds: ['critical_notify'],
          elseStepIds: [],
        },
        {
          type: 'action',
          id: 'critical_notify',
          connector: 'slack',
          action: 'message.send',
          params: { channel: '#critical', text: 'critical' },
          sideEffect: 'EXTERNAL',
        },
      ],
      permissions: {},
      approval: [],
      allowExternalAuto: true,
      assumptions: [],
      sideEffects: {},
      dataPolicy: {},
    };
    const modelRun = vi.fn();
    const investigationRunner: InvestigationRunner = {
      providerName: 'test-local',
      async run<T>(request: InvestigationRunRequest<T>) {
        modelRun();
        return { output: request.outputSchema.parse({ riskLevel: 'critical' }) };
      },
    };
    const decisionEngine: DecisionEngine = { evaluate: vi.fn(async () => ({ answers: {} })) };
    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);
    const runtime = new WorkflowRuntime({
      store,
      globalActive: true,
      workflowActive: {},
      connectors: createTestConnectors(),
      investigationRunner,
      decisionEngine,
    });

    const result = await runtime.executeWorkflow(ir, { ephemeral: true });

    expect(result).toMatchObject({ status: 'failed', errorCode: 'contract_validation_failed' });
    expect(result.log[0]).toMatchObject({
      code: 'contract_validation_failed',
      message: expect.stringContaining('classify.riskLevel'),
      data: {
        issues: expect.arrayContaining([
          expect.objectContaining({ code: 'invalid_workflow_schema', stepId: 'classify' }),
        ]),
      },
    });
    expect(modelRun).not.toHaveBeenCalled();
    expect(decisionEngine.evaluate).not.toHaveBeenCalled();
    expect(mockSlack(runtime.connectors).messages).toEqual([]);
  });

  it('rejects an LLM-generated number used to choose an execution branch', async () => {
    const ir: WorkflowIR = {
      name: '모델 숫자 분기 차단',
      goal: 'LLM이 계산한 수치로 실행 경로를 선택하지 않음',
      version: 1,
      trigger: { type: 'manual' },
      steps: [
        {
          type: 'ai_decision',
          id: 'analyze',
          goal: '전주 대비 변화율 계산',
          outputSchema: {
            type: 'object',
            properties: { changeRate: { type: 'number' } },
            required: ['changeRate'],
          },
          investigation: false,
          maxReads: 1,
        },
        {
          type: 'if',
          id: 'if_drop',
          condition: { op: 'lte', left: { ref: 'analyze.changeRate' }, right: { lit: -0.2 } },
          thenStepIds: ['alert'],
          elseStepIds: [],
        },
        {
          type: 'action',
          id: 'alert',
          connector: 'slack',
          action: 'message.send',
          params: { channel: '#sales', text: 'sales declined' },
          sideEffect: 'EXTERNAL',
        },
      ],
      permissions: {},
      approval: [],
      allowExternalAuto: true,
      assumptions: [],
      sideEffects: {},
      dataPolicy: {},
    };
    const modelRun = vi.fn();
    const investigationRunner: InvestigationRunner = {
      providerName: 'test-local',
      async run<T>(request: InvestigationRunRequest<T>) {
        modelRun();
        return { output: request.outputSchema.parse({ changeRate: -0.25 }) };
      },
    };
    const decisionEngine: DecisionEngine = { evaluate: vi.fn(async () => ({ answers: {} })) };
    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);
    const runtime = new WorkflowRuntime({
      store,
      globalActive: true,
      workflowActive: {},
      connectors: createTestConnectors(),
      investigationRunner,
      decisionEngine,
    });

    const result = await runtime.executeWorkflow(ir, { ephemeral: true });

    expect(result).toMatchObject({ status: 'failed', errorCode: 'contract_validation_failed' });
    expect(modelRun).not.toHaveBeenCalled();
    expect(decisionEngine.evaluate).not.toHaveBeenCalled();
    expect(mockSlack(runtime.connectors).messages).toEqual([]);
  });
});
