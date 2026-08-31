import { describe, expect, it } from 'vitest';
import { createDatabaseAsync } from '../store/db.js';
import { WorkflowStore } from '../store/workflow-store.js';
import { WorkflowRuntime } from './engine.js';
import { createTestConnectors, mockGmail, mockLocalFolder, mockSlack } from '../modules/test-connectors.js';
import { TriggerEngine } from './trigger-engine.js';
import type { WorkflowIR } from '../workflow/schema.js';

const gmailNotifySkill: WorkflowIR = {
  name: '새 메일 알림',
  goal: '새 Gmail 도착 시 Slack 알림',
  version: 1,
  trigger: { type: 'gmail.new_message', accountId: 'primary' },
  inputs: ['from', 'subject', 'body'],
  steps: [
    {
      type: 'action',
      id: 'notify',
      connector: 'slack',
      action: 'message.send',
      params: { channel: '#inbox', text: 'new mail' },
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

describe('TriggerEngine', () => {
  it('baselines on first poll and fires once for each new gmail message', async () => {
    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);
    const runtime = new WorkflowRuntime({ store, globalActive: true, workflowActive: {}, connectors: createTestConnectors() });
    mockGmail(runtime.connectors).messages.push({
      id: 'msg-existing',
      from: 'old@example.com',
      subject: '기존 메일',
      body: 'already here',
    });

    const { workflowId } = store.saveWorkflow(gmailNotifySkill);
    store.setWorkflowActive(workflowId, true);

    const engine = new TriggerEngine(store, runtime);

    await engine.tick();
    expect(mockSlack(runtime.connectors).messages).toHaveLength(0);

    mockGmail(runtime.connectors).messages.push({
      id: 'msg-new',
      from: 'plosind@naver.com',
      subject: '새 문의',
      body: '내용',
    });

    await engine.tick();
    expect(mockSlack(runtime.connectors).messages).toHaveLength(1);
    expect(mockSlack(runtime.connectors).messages[0]?.channel).toBe('#inbox');

    await engine.tick();
    expect(mockSlack(runtime.connectors).messages).toHaveLength(1);
  });

  it.each([
    ['a null cursor store', null],
    ['an array cursor store', []],
  ])('rebuilds polling state from %s', async (_label, corruptedCursors) => {
    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);
    const runtime = new WorkflowRuntime({
      store,
      globalActive: true,
      workflowActive: {},
      connectors: createTestConnectors(),
    });
    mockGmail(runtime.connectors).messages.push({
      id: 'msg-existing',
      from: 'old@example.com',
      subject: '기존 메일',
      body: 'already here',
    });
    const { workflowId } = store.saveWorkflow(gmailNotifySkill);
    store.setWorkflowActive(workflowId, true);
    store.setSetting('trigger.cursors', corruptedCursors);

    await new TriggerEngine(store, runtime).tick();

    expect(mockSlack(runtime.connectors).messages).toHaveLength(0);
    expect(store.getSetting<Record<string, unknown>>('trigger.cursors', {})[workflowId]).toMatchObject({
      initialized: true,
      seenMessageIds: ['msg-existing'],
    });
  });

  it('rebuilds a malformed workflow cursor without discarding valid cursors', async () => {
    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);
    const runtime = new WorkflowRuntime({
      store,
      globalActive: true,
      workflowActive: {},
      connectors: createTestConnectors(),
    });
    const { workflowId } = store.saveWorkflow(gmailNotifySkill);
    store.setWorkflowActive(workflowId, true);
    store.setSetting('trigger.cursors', {
      [workflowId]: { initialized: true, seenMessageIds: 'not-an-array' },
      'other-workflow': { initialized: true, seenMessageIds: ['msg-valid'] },
    });

    await new TriggerEngine(store, runtime).tick();

    expect(store.getSetting<Record<string, unknown>>('trigger.cursors', {})).toMatchObject({
      [workflowId]: { initialized: true, seenMessageIds: [] },
      'other-workflow': { initialized: true, seenMessageIds: ['msg-valid'] },
    });
  });

  it('does not advance a poll cursor when workflow execution fails', async () => {
    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);
    const runtime = new WorkflowRuntime({
      store,
      globalActive: true,
      workflowActive: {},
      connectors: createTestConnectors(),
    });
    const slack = mockSlack(runtime.connectors);
    let attempts = 0;
    runtime.connectors.slack = {
      name: slack.name,
      async execute(action, params, ctx) {
        if (action === 'message.send' && attempts++ === 0) {
          return { ok: false, error: 'temporary Slack failure', errorCode: 'temporary_failure' };
        }
        return slack.execute(action, params, ctx);
      },
    };

    const { workflowId } = store.saveWorkflow(gmailNotifySkill);
    store.setWorkflowActive(workflowId, true);
    const engine = new TriggerEngine(store, runtime);

    await engine.tick();
    mockGmail(runtime.connectors).messages.push({
      id: 'msg-retry',
      from: 'sender@example.com',
      subject: '재시도',
      body: '처리되어야 하는 메일',
    });

    await engine.tick();
    expect(slack.messages).toHaveLength(0);
    const afterFailure = store.getSetting<{ seenMessageIds?: string[] }>('trigger.cursors', {})[workflowId];
    expect(afterFailure?.seenMessageIds).not.toContain('msg-retry');

    await engine.tick();
    expect(slack.messages).toHaveLength(1);
    expect(slack.messages[0]?.channel).toBe('#inbox');
  });

  it('checkpoints a successful poll execution when stopped while it is in flight', async () => {
    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);
    const runtime = new WorkflowRuntime({
      store,
      globalActive: true,
      workflowActive: {},
      connectors: createTestConnectors(),
    });
    const slack = mockSlack(runtime.connectors);
    const execute = slack.execute.bind(slack);
    let releaseExecution!: () => void;
    let markExecutionStarted!: () => void;
    const executionStarted = new Promise<void>((resolve) => {
      markExecutionStarted = resolve;
    });
    const executionReleased = new Promise<void>((resolve) => {
      releaseExecution = resolve;
    });
    runtime.connectors.slack = {
      name: slack.name,
      async execute(action, params, ctx) {
        markExecutionStarted();
        await executionReleased;
        return execute(action, params, ctx);
      },
    };

    const { workflowId } = store.saveWorkflow(gmailNotifySkill);
    store.setWorkflowActive(workflowId, true);
    const engine = new TriggerEngine(store, runtime);
    await engine.tick();
    mockGmail(runtime.connectors).messages.push({
      id: 'msg-during-stop',
      from: 'sender@example.com',
      subject: '중지 중 완료',
      body: '한 번만 처리되어야 하는 메일',
    });

    const tick = engine.tick();
    await executionStarted;
    const stop = engine.stop();
    releaseExecution();
    await Promise.all([tick, stop]);

    expect(slack.messages).toHaveLength(1);
    expect(store.getSetting<{ seenMessageIds?: string[] }>('trigger.cursors', {})[workflowId]?.seenMessageIds)
      .toContain('msg-during-stop');
    expect(db.prepare('SELECT status FROM trigger_receipts').get()).toEqual({ status: 'completed' });

    await engine.tick();
    expect(slack.messages).toHaveLength(1);
  });

  it('filters event payloads before executing downstream steps', async () => {
    const filteredWorkflow: WorkflowIR = {
      ...gmailNotifySkill,
      name: '발신자 필터 알림',
      trigger: {
        type: 'gmail.new_message',
        accountId: 'primary',
        filter: {
          op: 'eq',
          left: { ref: 'from' },
          right: { lit: 'sender@example.com' },
        },
      },
    };
    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);
    const runtime = new WorkflowRuntime({ store, globalActive: true, workflowActive: {}, connectors: createTestConnectors() });
    const { workflowId } = store.saveWorkflow(filteredWorkflow);
    store.setWorkflowActive(workflowId, true);
    const engine = new TriggerEngine(store, runtime);

    await engine.tick();
    mockGmail(runtime.connectors).messages.push(
      { id: 'msg-other', from: 'other@example.com', subject: '무시', body: '무시' },
      { id: 'msg-match', from: 'sender@example.com', subject: '처리', body: '처리' },
    );

    await engine.tick();

    expect(mockSlack(runtime.connectors).messages).toHaveLength(1);
    expect(mockSlack(runtime.connectors).messages[0]?.text).toBe('new mail');
  });

  it('does not poll inactive works', async () => {
    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);
    const runtime = new WorkflowRuntime({ store, globalActive: true, workflowActive: {}, connectors: createTestConnectors() });
    const { workflowId } = store.saveWorkflow(gmailNotifySkill);
    store.setWorkflowActive(workflowId, false);

    const engine = new TriggerEngine(store, runtime);
    await engine.tick();

    mockGmail(runtime.connectors).messages.push({
      id: 'msg-new',
      from: 'a@b.com',
      subject: 'test',
      body: 'body',
    });
    await engine.tick();
    expect(mockSlack(runtime.connectors).messages).toHaveLength(0);
  });

  it('baselines slack trigger and fires once for each new channel message', async () => {
    const slackNotifySkill: WorkflowIR = {
      name: 'Slack 알림',
      goal: 'Slack 새 메시지 시 알림 채널로 전달',
      version: 1,
      trigger: { type: 'slack.new_message', channel: '#general' },
      inputs: ['text', 'user', 'channel'],
      steps: [
        {
          type: 'action',
          id: 'notify',
          connector: 'slack',
          action: 'message.send',
          params: { channel: '#alerts', text: 'new slack message' },
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
    mockSlack(runtime.connectors).inbound.push({
      channel: '#general',
      text: '기존 메시지',
      ts: '100.000',
      user: 'U_OLD',
    });

    const { workflowId } = store.saveWorkflow(slackNotifySkill);
    store.setWorkflowActive(workflowId, true);
    const engine = new TriggerEngine(store, runtime);

    await engine.tick();
    expect(mockSlack(runtime.connectors).messages).toHaveLength(0);

    mockSlack(runtime.connectors).inbound.push({
      channel: '#general',
      text: '새 메시지',
      ts: '101.000',
      user: 'U_NEW',
    });

    await engine.tick();
    expect(mockSlack(runtime.connectors).messages).toHaveLength(1);
    expect(mockSlack(runtime.connectors).messages[0]?.channel).toBe('#alerts');

    await engine.tick();
    expect(mockSlack(runtime.connectors).messages).toHaveLength(1);
  });

  it('baselines local folder trigger and fires once for each new file', async () => {
    const folderWorkflow: WorkflowIR = {
      name: '새 PDF 요약',
      goal: '폴더에 PDF가 생기면 요약',
      version: 1,
      trigger: { type: 'local_folder.new_file', folderId: 'folder-inbox', extensions: ['.pdf'] },
      inputs: ['filePath', 'fileName'],
      steps: [
        {
          type: 'action',
          id: 'notify',
          connector: 'slack',
          action: 'message.send',
          params: { channel: '#docs', text: 'new file' },
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
    mockLocalFolder(runtime.connectors).files['folder-inbox'] = ['/mock/inbox/existing.pdf'];

    const { workflowId } = store.saveWorkflow(folderWorkflow);
    store.setWorkflowActive(workflowId, true);
    const engine = new TriggerEngine(store, runtime);

    await engine.tick();
    expect(mockSlack(runtime.connectors).messages).toHaveLength(0);

    mockLocalFolder(runtime.connectors).files['folder-inbox'].push('/mock/inbox/report.pdf');
    await engine.tick();
    expect(mockSlack(runtime.connectors).messages).toHaveLength(1);

    await engine.tick();
    expect(mockSlack(runtime.connectors).messages).toHaveLength(1);
  });

  it('runs enabled webhook workflows and ignores disabled ones', async () => {
    const port = 38_910;
    const webhookWorkflow: WorkflowIR = {
      name: 'Webhook 업무',
      goal: 'Webhook 수신 시 Slack 알림',
      version: 1,
      trigger: { type: 'webhook.inbound', path: 'invoice-paid' },
      inputs: ['path', 'body'],
      steps: [
        {
          type: 'action',
          id: 'notify',
          connector: 'slack',
          action: 'message.send',
          params: { channel: '#webhooks', text: 'webhook received' },
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
    const runtime = new WorkflowRuntime({
      store,
      globalActive: true,
      workflowActive: {},
      connectors: createTestConnectors(),
    });
    store.setConnection('webhook', true, {
      port,
      secret: 'hook-secret',
      secretStored: true,
    });

    const { workflowId } = store.saveWorkflow(webhookWorkflow);
    store.setWorkflowActive(workflowId, true);
    const engine = new TriggerEngine(store, runtime);
    engine.start();
    await engine.refreshPushTransports();

    const accepted = await fetch(`http://127.0.0.1:${port}/hooks/invoice-paid`, {
      method: 'POST',
      headers: { 'x-ax-webhook-secret': 'hook-secret' },
      body: '{"id":1}',
    });
    expect(accepted.status).toBe(202);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(mockSlack(runtime.connectors).messages).toHaveLength(1);

    store.setWorkflowActive(workflowId, false);
    const ignored = await fetch(`http://127.0.0.1:${port}/hooks/invoice-paid`, {
      method: 'POST',
      headers: { 'x-ax-webhook-secret': 'hook-secret' },
      body: '{"id":2}',
    });
    expect(ignored.status).toBe(202);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(mockSlack(runtime.connectors).messages).toHaveLength(1);

    await engine.stop();
  });
});
