import { describe, expect, it } from 'vitest';
import { createDatabaseAsync } from '../../../store/db.js';
import { WorkflowStore } from '../../../store/workflow-store.js';
import { WorkflowRuntime } from '../../engine.js';
import type { WorkflowIR } from '../../../workflow/schema.js';
import { createAgentHarness, createInvestigationRunner } from '../../../agent/harness.js';
import { createTestConnectors, mockSlack } from '../../../modules/test-connectors.js';
import { RiskProvider } from '../fixtures.js';

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
    const runtime = new WorkflowRuntime({
      store,
      globalActive: true,
      workflowActive: {},
      connectors: createTestConnectors(),
      investigationRunner: createInvestigationRunner(createAgentHarness(new RiskProvider())),
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
});
