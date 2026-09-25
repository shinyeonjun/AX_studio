import { describe, expect, it, vi } from 'vitest';
import { weeklyReportWorkflowFixture } from '../../../testing/fixtures/workflows.js';
import { createDatabaseAsync } from '../../../persistence/db.js';
import { WorkflowStore } from '../../../persistence/workflow-store.js';
import { WorkflowRuntime } from '../../engine.js';
import { linearSteps } from '../../control-flow.js';
import type { WorkflowIR } from '../../../workflow/schema.js';
import { createAgentHarness, createInvestigationRunner } from '../../../intelligence/agent/harness.js';
import { createTestConnectors, mockSlack } from '../../../testing/connectors/test-connectors.js';
import { NoReadProvider } from '../fixtures.js';

describe('runtime control-flow selection', () => {
  it('does not execute if-branch targets from the linear scan', () => {
    const ids = linearSteps(weeklyReportWorkflowFixture.steps).map((step) => step.id);
    expect(ids).toEqual(['read_sheet', 'analyze', 'if_drop']);
    expect(ids).not.toContain('slack_alert');
    expect(ids).not.toContain('slack_report');
  });

  it('runs exactly one slack branch for weekly report', async () => {
    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);
    const modelProvider = new NoReadProvider();
    const generateStructured = vi.spyOn(modelProvider, 'generateStructured');
    const runtime = new WorkflowRuntime({
      store,
      globalActive: true,
      workflowActive: {},
      connectors: createTestConnectors(),
      investigationRunner: createInvestigationRunner(createAgentHarness(modelProvider)),
      decisionEngine: {
        evaluate: async ({ questions }) => ({
          answers: Object.fromEntries(Object.keys(questions).map((id) => [id, {
            type: 'choice' as const,
            choice: id === 'output_0' ? 'true' : 'false',
            probabilities: { [id === 'output_0' ? 'true' : 'false']: 0.4 },
          }])),
          model: 'jev-test',
        }),
      },
    });
    const result = await runtime.executeWorkflow(weeklyReportWorkflowFixture, { ephemeral: true });
    expect(result.status).toBe('success');
    expect(mockSlack(runtime.connectors).messages).toEqual([
      { channel: '#sales', text: '매출 하락 경보' },
    ]);
    expect(generateStructured).not.toHaveBeenCalled();
  });

  it('evaluates if conditions from trigger input', async () => {
    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);
    const runtime = new WorkflowRuntime({ store, globalActive: true, workflowActive: {}, connectors: createTestConnectors() });
    const ir: WorkflowIR = {
      name: '발신자 필터',
      goal: '특정 발신자만 알림',
      version: 1,
      steps: [
        {
          type: 'if',
          id: 'filter_sender',
          condition: { op: 'contains', left: { ref: 'sender' }, right: { lit: 'plosind@naver.com' } },
          thenStepIds: ['notify'],
          elseStepIds: [],
        },
        {
          type: 'action',
          id: 'notify',
          connector: 'slack',
          action: 'message.send',
          params: { channel: '#inbox', text: 'matched' },
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
    await runtime.executeWorkflow(ir, {
      ephemeral: true,
      input: { sender: 'plosind@naver.com', from: 'plosind@naver.com' },
    });
    expect(mockSlack(runtime.connectors).messages).toHaveLength(1);
  });
});
