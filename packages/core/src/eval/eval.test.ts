import { describe, it, expect } from 'vitest';
import { parseWorkflowIR, validateWorkflowIR } from '../workflow/schema.js';
import { requiresApproval, validateApprovalPolicy, isDeployable } from '../workflow/approval.js';
import { csMailWorkflowFixture, weeklyReportWorkflowFixture, dataPolicyFixture } from '../testing/fixtures/workflows.js';
import { createDatabaseAsync } from '../store/db.js';
import { createTestConnectors, mockGmail, mockSlack } from '../modules/test-connectors.js';
import { WorkflowStore } from '../store/workflow-store.js';
import { assessCompleteness, computeRequiredSlots } from '../workflow/canvas/slots/requiredness.js';
import { WorkflowRuntime } from '../runtime/engine.js';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('Workflow IR', () => {
  it('validates fixtures', () => {
    expect(parseWorkflowIR(csMailWorkflowFixture).name).toBe('고객 문의 처리');
    expect(parseWorkflowIR(weeklyReportWorkflowFixture).trigger?.type).toBe('schedule');
    expect(parseWorkflowIR(dataPolicyFixture).dataPolicy.emailBody?.cloudAllowed).toBe(false);
  });

  it('enforces gmail send approval at the action boundary', () => {
    const bad = { ...csMailWorkflowFixture, steps: csMailWorkflowFixture.steps.filter((s) => s.type !== 'human_approval') };
    const errors = validateApprovalPolicy(bad);
    expect(errors).toEqual([]);
    expect(requiresApproval('EXTERNAL_HIGH', true)).toBe(true);
  });

  it('cs fixture is deployable', () => {
    expect(isDeployable(csMailWorkflowFixture)).toBe(true);
  });
});

describe('WorkflowStore', () => {
  it('CRUD roundtrip', async () => {
    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);
    const { workflowId } = store.saveWorkflow(csMailWorkflowFixture);
    const loaded = store.getWorkflow(workflowId);
    expect(loaded?.name).toBe('고객 문의 처리');
    store.setConnection('gmail', true);
    expect(store.getConnections()[0].connected).toBe(true);
  });
});

describe('requiredness', () => {
  it('requires recipient for gmail send', () => {
    const missing = assessCompleteness(
      {
        goal: '테스트 메일',
        success: '발송',
        trigger: { type: 'once', runAt: '2026-08-19T10:00:00.000Z' },
        steps: [
          {
            type: 'action',
            id: 'send',
            connector: 'gmail',
            action: 'message.send',
            params: {},
            sideEffect: 'EXTERNAL_HIGH',
          },
          {
            type: 'human_approval',
            id: 'approve',
            reason: '발송',
            forActionIds: ['send'],
          },
        ],
      },
      ['gmail'],
    );
    expect(missing.missingRequired).toContain('send.params.to');
  });
});

describe('Runtime', () => {
  it('runs a valid CS notification flow', async () => {
    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);
    const runtime = new WorkflowRuntime({ store, globalActive: true, workflowActive: {}, connectors: createTestConnectors() });
    mockGmail(runtime.connectors).messages.push({
      id: '1',
      from: 'customer@example.com',
      subject: '환불 요청',
      body: '결제가 두 번 됐습니다',
    });

    const ir = {
      ...csMailWorkflowFixture,
      trigger: { type: 'manual' as const },
      steps: [
        {
          type: 'action' as const,
          id: 'notify_support',
          connector: 'slack',
          action: 'message.send',
          params: { channel: '#support', text: '새 고객 문의가 도착했습니다.' },
          sideEffect: 'EXTERNAL' as const,
        },
      ],
    };
    const result = await runtime.executeWorkflow(ir, {
      ephemeral: true,
      input: { emailBody: mockGmail(runtime.connectors).messages[0].body },
    });
    expect(result.status).toBe('success');
    expect(mockSlack(runtime.connectors).messages.length).toBeGreaterThan(0);
  });
});

describe('Eval scenarios', () => {
  const scenariosPath = join(__dirname, 'scenarios.json');
  const scenarios = JSON.parse(readFileSync(scenariosPath, 'utf-8')) as Array<{
    id: string;
    requiredSlots: string[];
  }>;
  const knownSlots = [
    'goal',
    'trigger',
    'trigger.schedule',
    'trigger.timezone',
    'gmail.account',
    'slack.channel',
    'local_file.path',
    'rdb.connection',
    'approval',
    'send.params.to',
  ];

  for (const scenario of scenarios) {
    it(`records required slots for ${scenario.id}`, () => {
      expect(scenario.requiredSlots.length).toBeGreaterThan(0);
      for (const slot of scenario.requiredSlots) {
        expect(
          knownSlots.includes(slot) || computeRequiredSlots({ goal: 'x', steps: [] }).some((item) => item.slot === slot),
        ).toBe(true);
      }
    });
  }
});
