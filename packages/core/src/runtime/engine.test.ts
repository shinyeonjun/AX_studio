import { describe, expect, it } from 'vitest';
import { weeklyReportWorkflowFixture } from '../workflow/fixtures.js';
import { createDatabaseAsync } from '../store/db.js';
import { WorkflowStore } from '../store/workflow-store.js';
import { WorkflowRuntime } from './engine.js';
import { linearSteps } from './control-flow.js';
import type { WorkflowIR } from '../workflow/schema.js';
import { createAgentHarness, createInvestigationRunner } from '../agent/harness.js';
import type { ModelProvider, StructuredGenerateInput, TextGenerateInput } from '../agent/model/provider.js';
import { createTestConnectors, mockSlack, mockGmail } from '../modules/test-connectors.js';

class NoReadProvider implements ModelProvider {
  readonly name = 'test-agent';

  async generateStructured<T>(input: StructuredGenerateInput<T>): Promise<T> {
    return input.schema.parse({ needMore: false, conclusion: '주간 보고 결과', changeRate: 0 }) as T;
  }

  async generateText(input: TextGenerateInput): Promise<string> {
    return input.user ?? '';
  }
}

class RiskProvider implements ModelProvider {
  readonly name = 'risk-test-agent';

  async generateStructured<T>(input: StructuredGenerateInput<T>): Promise<T> {
    return input.schema.parse({ needMore: false, riskLevel: 'normal' }) as T;
  }

  async generateText(input: TextGenerateInput): Promise<string> {
    return input.user ?? '';
  }
}

describe('runtime control flow', () => {
  it('replaces and removes live connectors without restarting the runtime', async () => {
    const store = new WorkflowStore(await createDatabaseAsync(':memory:'));
    const runtime = new WorkflowRuntime({ store, globalActive: true, workflowActive: {}, connectors: {} });
    const connector = { name: 'dynamic', execute: async () => ({ ok: true, data: {} }) };

    runtime.setConnector('dynamic', connector);
    expect(runtime.connectors.dynamic).toBe(connector);

    runtime.setConnector('dynamic', null);
    expect(runtime.connectors.dynamic).toBeUndefined();
  });

  it('rejects malformed workflow input before contract evaluation', async () => {
    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);
    const runtime = new WorkflowRuntime({
      store,
      globalActive: true,
      workflowActive: {},
      connectors: createTestConnectors(),
    });

    const result = await runtime.executeWorkflow({ steps: 'not-an-array' } as unknown as WorkflowIR);

    expect(result.status).toBe('failed');
    expect(result.errorCode).toBe('invalid_workflow_schema');
    expect(result.executionId).not.toBe('');
    expect(store.getExecution(result.executionId)).toMatchObject({
      status: 'failed',
      errorCode: 'invalid_workflow_schema',
    });
  });

  it('records preflight cancellation instead of hiding it from activity', async () => {
    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);
    const runtime = new WorkflowRuntime({ store, globalActive: false, workflowActive: {}, connectors: {} });

    const result = await runtime.executeWorkflow(
      { name: '퇴근 상태', goal: '실행하지 않음', version: 1, steps: [], permissions: {}, approval: [], allowExternalAuto: true, assumptions: [], sideEffects: {}, dataPolicy: {} },
      { ephemeral: true, triggerType: 'manual' },
    );

    expect(result).toMatchObject({ status: 'cancelled', errorCode: 'global_off_duty' });
    expect(result.executionId).not.toBe('');
    expect(store.getExecution(result.executionId)).toMatchObject({
      status: 'cancelled',
      errorCode: 'global_off_duty',
      ephemeral: true,
    });
  });

  it('does not execute if-branch targets from the linear scan', () => {
    const ids = linearSteps(weeklyReportWorkflowFixture.steps).map((step) => step.id);
    expect(ids).toEqual(['read_sheet', 'analyze', 'if_drop']);
    expect(ids).not.toContain('slack_alert');
    expect(ids).not.toContain('slack_report');
  });

  it('runs exactly one slack branch for weekly report', async () => {
    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);
    const runtime = new WorkflowRuntime({
      store,
      globalActive: true,
      workflowActive: {},
      connectors: createTestConnectors(),
      investigationRunner: createInvestigationRunner(createAgentHarness(new NoReadProvider())),
    });
    const result = await runtime.executeWorkflow(weeklyReportWorkflowFixture, { ephemeral: true });
    expect(result.status).toBe('success');
    expect(mockSlack(runtime.connectors).messages).toHaveLength(1);
  });

  it('records an ephemeral run without creating a saved workflow reference', async () => {
    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);
    const runtime = new WorkflowRuntime({
      store,
      globalActive: true,
      workflowActive: {},
      connectors: createTestConnectors(),
    });
    const result = await runtime.executeWorkflow(
      {
        id: 'draft-only-workflow',
        name: '일회 실행',
        goal: '한 번만 알림',
        version: 1,
        steps: [
          {
            type: 'action',
            id: 'notify',
            connector: 'slack',
            action: 'message.send',
            params: { channel: '#once', text: 'done' },
            sideEffect: 'EXTERNAL',
          },
        ],
        permissions: {},
        approval: [],
        allowExternalAuto: true,
        assumptions: [],
        sideEffects: {},
        dataPolicy: {},
      },
      { ephemeral: true, triggerType: 'manual' },
    );

    expect(result.status).toBe('success');
    expect(store.listWorkflows()).toHaveLength(0);
    expect(store.getExecution(result.executionId)).toMatchObject({
      workflowId: null,
      ephemeral: true,
      status: 'success',
    });
  });

  it('serializes queued one-shot runs and records each as ephemeral', async () => {
    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);
    const events: string[] = [];
    const runtime = new WorkflowRuntime({
      store,
      globalActive: true,
      workflowActive: {},
      connectors: {},
      onExecutionStarted: (executionId) => events.push(`start:${executionId}`),
      onExecutionFinished: (result) => events.push(`finish:${result.executionId}`),
    });
    const plan: WorkflowIR = {
      id: 'queued-draft',
      name: '큐 일회 실행',
      goal: '한 번씩 순서대로 처리한다',
      version: 1,
      steps: [],
      permissions: {},
      approval: [],
      allowExternalAuto: true,
      assumptions: [],
      sideEffects: {},
      dataPolicy: {},
    };

    const first = runtime.enqueueEphemeralWorkflow(plan);
    const second = runtime.enqueueEphemeralWorkflow(plan);
    await runtime.waitForIdle();

    expect(first.jobId).not.toBe(second.jobId);
    expect(events).toHaveLength(4);
    expect(events[0]?.startsWith('start:')).toBe(true);
    expect(events[1]?.startsWith('finish:')).toBe(true);
    expect(events[2]?.startsWith('start:')).toBe(true);
    expect(events[3]?.startsWith('finish:')).toBe(true);
    expect(store.listWorkflows()).toHaveLength(0);
    expect(store.listExecutions(10)).toHaveLength(2);
    expect(store.listExecutions(10).every((execution) => execution.ephemeral)).toBe(true);
  });

  it('reports and persists step progress while a workflow runs', async () => {
    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);
    const progress: string[] = [];
    const runtime = new WorkflowRuntime({
      store,
      globalActive: true,
      workflowActive: {},
      connectors: createTestConnectors(),
      onExecutionProgress: (event) => progress.push(`${event.stepId}:${event.status}`),
    });

    const result = await runtime.executeWorkflow(
      {
        name: '진행 상태 기록',
        goal: '단계 진행을 기록',
        version: 1,
        steps: [
          {
            type: 'action',
            id: 'notify',
            connector: 'slack',
            action: 'message.send',
            params: { channel: '#progress', text: 'done' },
            sideEffect: 'EXTERNAL',
          },
        ],
        permissions: {},
        approval: [],
        allowExternalAuto: true,
        assumptions: [],
        sideEffects: {},
        dataPolicy: {},
      },
      { ephemeral: true, triggerType: 'manual' },
    );

    expect(result.status).toBe('success');
    expect(progress).toEqual(['notify:step_started', 'notify:step_completed']);
    const persistedLog = JSON.parse(store.getExecution(result.executionId)?.logJson ?? '[]') as Array<{
      code?: string;
    }>;
    expect(persistedLog.map((entry) => entry.code).filter((code): code is string => Boolean(code))).toEqual([
      'step_started',
      'step_completed',
    ]);
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

  it('does not execute outer steps twice after a branch completes normally', async () => {
    const ir: WorkflowIR = {
      name: '정상 분기 후속 실행',
      goal: '분기와 바깥 후속 알림을 각각 한 번 실행',
      version: 1,
      steps: [
        {
          type: 'if',
          id: 'branch',
          condition: { op: 'eq', left: { ref: 'flag' }, right: { lit: true } },
          thenStepIds: ['branch_notify'],
          elseStepIds: [],
        },
        {
          type: 'action',
          id: 'branch_notify',
          connector: 'slack',
          action: 'message.send',
          params: { channel: '#branch', text: 'inside' },
          sideEffect: 'EXTERNAL',
        },
        {
          type: 'action',
          id: 'outer_tail',
          connector: 'slack',
          action: 'message.send',
          params: { channel: '#tail', text: 'outside' },
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

    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);
    const runtime = new WorkflowRuntime({ store, globalActive: true, workflowActive: {}, connectors: createTestConnectors() });
    const result = await runtime.executeWorkflow(ir, { ephemeral: true, input: { flag: true } });

    expect(result.status).toBe('success');
    expect(mockSlack(runtime.connectors).messages.map((message) => message.channel)).toEqual(['#branch', '#tail']);
  });

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

  it('resumes remaining steps after approval', async () => {
    const ir: WorkflowIR = {
      name: '승인 후 보고',
      goal: '보내고 알림',
      version: 1,
      steps: [
        {
          type: 'human_approval',
          id: 'approve_send',
          reason: '메일 발송',
          forActionIds: ['send_mail'],
        },
        {
          type: 'action',
          id: 'send_mail',
          connector: 'gmail',
          action: 'message.send',
          params: { to: 'a@b.com', body: 'hi' },
          sideEffect: 'EXTERNAL_HIGH',
        },
        {
          type: 'action',
          id: 'notify',
          connector: 'slack',
          action: 'message.send',
          params: { channel: '#ops', text: 'sent' },
          sideEffect: 'EXTERNAL',
        },
      ],
      permissions: {},
      approval: ['gmail.send'],
      allowExternalAuto: true,
      assumptions: [],
      sideEffects: {},
      dataPolicy: {},
    };

    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);
    const runtime = new WorkflowRuntime({ store, globalActive: true, workflowActive: {}, connectors: createTestConnectors() });
    const first = await runtime.executeWorkflow(ir, { ephemeral: true });
    expect(first.status).toBe('pending_approval');
    expect(store.getExecution(first.executionId)).toMatchObject({
      status: 'pending_approval',
      errorCode: 'pending_approval',
      finishedAt: null,
    });
    expect(mockGmail(runtime.connectors).sent).toHaveLength(0);
    expect(mockSlack(runtime.connectors).messages).toHaveLength(0);

    const [resumed, duplicate] = await Promise.all([
      runtime.continueAfterApproval(first.pendingApprovalId!),
      runtime.continueAfterApproval(first.pendingApprovalId!),
    ]);
    expect(resumed.status).toBe('success');
    expect(['approval_in_progress', 'approval_already_resolved']).toContain(duplicate.errorCode);
    expect(mockGmail(runtime.connectors).sent).toHaveLength(1);
    expect(mockSlack(runtime.connectors).messages).toHaveLength(1);
    expect(mockSlack(runtime.connectors).messages[0]?.channel).toBe('#ops');
  });

  it('resumes outer steps after approval inside an if branch', async () => {
    const ir: WorkflowIR = {
      name: '분기 승인 후 후속',
      goal: '조건 분기 승인 뒤 바깥 단계 실행',
      version: 1,
      steps: [
        {
          type: 'if',
          id: 'branch',
          condition: { op: 'eq', left: { ref: 'flag' }, right: { lit: true } },
          thenStepIds: ['approve_branch', 'branch_followup'],
          elseStepIds: [],
        },
        {
          type: 'human_approval',
          id: 'approve_branch',
          reason: '분기 작업 승인',
          forActionIds: ['branch_action'],
        },
        {
          type: 'action',
          id: 'branch_action',
          connector: 'slack',
          action: 'message.send',
          params: { channel: '#branch', text: 'inside' },
          sideEffect: 'EXTERNAL',
        },
        {
          type: 'action',
          id: 'branch_followup',
          connector: 'slack',
          action: 'message.send',
          params: { channel: '#branch-follow', text: 'after branch' },
          sideEffect: 'EXTERNAL',
        },
        {
          type: 'action',
          id: 'outer_tail',
          connector: 'slack',
          action: 'message.send',
          params: { channel: '#tail', text: 'outer done' },
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

    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);
    const runtime = new WorkflowRuntime({ store, globalActive: true, workflowActive: {}, connectors: createTestConnectors() });
    const first = await runtime.executeWorkflow(ir, {
      ephemeral: true,
      input: { flag: true },
    });
    expect(first.status).toBe('pending_approval');
    expect(store.getExecution(first.executionId)?.status).toBe('pending_approval');

    const resumed = await runtime.continueAfterApproval(first.pendingApprovalId!);
    expect(resumed.status).toBe('success');
    expect(mockSlack(runtime.connectors).messages.map((m) => m.channel)).toEqual(['#branch', '#branch-follow', '#tail']);
  });

  it('does not resume an external approval while global execution is off', async () => {
    const ir: WorkflowIR = {
      name: '퇴근 승인 차단',
      goal: '전역 실행 중지 중에는 승인 후 전송하지 않음',
      version: 1,
      steps: [
        {
          type: 'action',
          id: 'send_alert',
          connector: 'slack',
          action: 'message.send',
          params: { channel: '#ops', text: 'must wait' },
          sideEffect: 'EXTERNAL',
        },
      ],
      permissions: {},
      approval: [],
      allowExternalAuto: false,
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
    });

    const first = await runtime.executeWorkflow(ir, { ephemeral: true });
    expect(first.status).toBe('pending_approval');
    runtime.setGlobalActive(false);

    const blocked = await runtime.continueAfterApproval(first.pendingApprovalId!);

    expect(blocked).toMatchObject({ status: 'cancelled', errorCode: 'global_off_duty' });
    expect(store.getApproval(first.pendingApprovalId!)?.status).toBe('pending');
    expect(mockSlack(runtime.connectors).messages).toHaveLength(0);
  });

  it('does not let a high-side-effect action bypass approval when a branch skips its approval node', async () => {
    const ir: WorkflowIR = {
      name: '분기 승인 우회 방지',
      goal: '분기에서 메일을 승인 후 발송',
      version: 1,
      steps: [
        {
          type: 'if',
          id: 'branch',
          condition: { op: 'eq', left: { ref: 'flag' }, right: { lit: true } },
          thenStepIds: ['send_mail'],
          elseStepIds: [],
        },
        {
          type: 'human_approval',
          id: 'unused_approval',
          reason: '메일 발송',
          forActionIds: ['send_mail'],
        },
        {
          type: 'action',
          id: 'send_mail',
          connector: 'gmail',
          action: 'message.send',
          params: { to: 'a@b.com', body: 'approved body' },
          sideEffect: 'EXTERNAL_HIGH',
        },
      ],
      permissions: {},
      approval: ['gmail.send'],
      allowExternalAuto: true,
      assumptions: [],
      sideEffects: {},
      dataPolicy: {},
    };

    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);
    const runtime = new WorkflowRuntime({ store, globalActive: true, workflowActive: {}, connectors: createTestConnectors() });
    const first = await runtime.executeWorkflow(ir, { ephemeral: true, input: { flag: true } });

    expect(first.status).toBe('pending_approval');
    expect(mockGmail(runtime.connectors).sent).toHaveLength(0);

    const resumed = await runtime.continueAfterApproval(first.pendingApprovalId!);

    expect(resumed.status).toBe('success');
    expect(mockGmail(runtime.connectors).sent).toHaveLength(1);
  });

  it('fails approval continuation when gmail body is missing', async () => {
    const ir: WorkflowIR = {
      name: '본문 없는 메일',
      goal: '메일 보내기',
      version: 1,
      steps: [
        {
          type: 'human_approval',
          id: 'approve_send',
          reason: '메일 발송',
          forActionIds: ['send_mail'],
        },
        {
          type: 'action',
          id: 'send_mail',
          connector: 'gmail',
          action: 'message.send',
          params: { to: 'a@b.com', subject: 'hi' },
          sideEffect: 'EXTERNAL_HIGH',
        },
      ],
      permissions: {},
      approval: ['gmail.send'],
      allowExternalAuto: true,
      assumptions: [],
      sideEffects: {},
      dataPolicy: {},
    };

    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);
    const runtime = new WorkflowRuntime({ store, globalActive: true, workflowActive: {}, connectors: createTestConnectors() });
    const first = await runtime.executeWorkflow(ir, { ephemeral: true });

    expect(first.status).toBe('failed');
    expect(first.errorCode).toBe('action_params_missing');
    expect(store.getPendingApprovals()).toHaveLength(0);
  });

  it('resolves approval and reports failure when required params stay missing', async () => {
    const ir: WorkflowIR = {
      name: '수신자 없는 메일',
      goal: '메일 보내기',
      version: 1,
      steps: [
        {
          type: 'human_approval',
          id: 'approve_send',
          reason: '메일 발송',
          forActionIds: ['send_mail'],
        },
        {
          type: 'action',
          id: 'send_mail',
          connector: 'gmail',
          action: 'message.send',
          params: { subject: 'hi' },
          sideEffect: 'EXTERNAL_HIGH',
        },
      ],
      permissions: {},
      approval: ['gmail.send'],
      allowExternalAuto: true,
      assumptions: [],
      sideEffects: {},
      dataPolicy: {},
    };

    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);
    const runtime = new WorkflowRuntime({ store, globalActive: true, workflowActive: {}, connectors: createTestConnectors() });
    const first = await runtime.executeWorkflow(ir, { ephemeral: true });

    expect(first.status).toBe('failed');
    expect(first.errorCode).toBe('action_params_missing');
    expect(store.getPendingApprovals()).toHaveLength(0);
  });

  it('closes an approval when its execution was deleted before resume', async () => {
    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);
    const runtime = new WorkflowRuntime({ store, globalActive: true, workflowActive: {}, connectors: createTestConnectors() });
    const approvalId = store.createApproval({
      executionId: 'deleted-execution',
      actionIds: ['send_mail'],
      reason: '삭제된 실행 재개 확인',
    });

    const result = await runtime.continueAfterApproval(approvalId);

    expect(result.errorCode).toBe('execution_not_found');
    expect(store.getApproval(approvalId)?.status).toBe('failed');
    expect(store.getPendingApprovals()).toHaveLength(0);
  });

  it('fails closed when an approval execution snapshot is corrupted', async () => {
    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);
    const runtime = new WorkflowRuntime({ store, globalActive: true, workflowActive: {}, connectors: createTestConnectors() });
    const executionId = store.createExecution({
      workflowId: 'workflow-1',
      workflowVersion: 1,
      ephemeral: true,
      irJson: '{not-json',
    });
    const approvalId = store.createApproval({
      executionId,
      actionIds: ['send_mail'],
      reason: '손상된 스냅샷 재개 확인',
    });

    const result = await runtime.continueAfterApproval(approvalId);

    expect(result.errorCode).toBe('invalid_execution_snapshot');
    expect(store.getApproval(approvalId)?.status).toBe('failed');
  });

  it('fails closed when an approval execution snapshot is absent', async () => {
    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);
    const runtime = new WorkflowRuntime({ store, globalActive: true, workflowActive: {}, connectors: createTestConnectors() });
    const executionId = store.createExecution({ workflowId: 'workflow-1', workflowVersion: 1, ephemeral: true });
    const approvalId = store.createApproval({
      executionId,
      actionIds: ['send_mail'],
      reason: '스냅샷 누락 재개 확인',
    });

    const result = await runtime.continueAfterApproval(approvalId);

    expect(result.errorCode).toBe('invalid_execution_snapshot');
    expect(store.getApproval(approvalId)?.status).toBe('failed');
    expect(store.getExecution(executionId)?.errorCode).toBe('invalid_execution_snapshot');
  });

  it('fails closed when the persisted approval execution log is malformed', async () => {
    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);
    const runtime = new WorkflowRuntime({ store, globalActive: true, workflowActive: {}, connectors: createTestConnectors() });
    const executionId = store.createExecution({
      workflowId: 'workflow-1',
      workflowVersion: 1,
      ephemeral: true,
      irJson: JSON.stringify({ name: '재개', goal: '재개', steps: [], permissions: {}, approval: [], allowExternalAuto: true }),
    });
    db.prepare('UPDATE executions SET log_json = ? WHERE id = ?').run('{broken', executionId);
    const approvalId = store.createApproval({
      executionId,
      actionIds: [],
      reason: '로그 손상 재개 확인',
    });

    const result = await runtime.continueAfterApproval(approvalId);

    expect(result.errorCode).toBe('invalid_execution_log');
    expect(store.getApproval(approvalId)?.status).toBe('failed');
    expect(store.getExecution(executionId)?.errorCode).toBe('invalid_execution_log');
  });

  it('fails closed when a real connector was not configured', async () => {
    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);
    const runtime = new WorkflowRuntime({ store, globalActive: true, workflowActive: {} });
    const result = await runtime.executeWorkflow(
      {
        name: '연결 누락',
        goal: '가짜 전송 금지',
        version: 1,
        trigger: { type: 'manual' },
        steps: [
          {
            type: 'action',
            id: 'notify',
            connector: 'slack',
            action: 'message.send',
            params: { channel: '#ops', text: 'must fail' },
            sideEffect: 'EXTERNAL',
          },
        ],
        permissions: {},
        approval: [],
        allowExternalAuto: true,
        assumptions: [],
        sideEffects: {},
        dataPolicy: {},
      },
      { ephemeral: true },
    );

    expect(result.status).toBe('failed');
    expect(result.errorCode).toBe('connector_missing');
  });
});
