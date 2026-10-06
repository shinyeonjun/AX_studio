import { describe, expect, it } from 'vitest';
import { httpEndpointsFromConnections } from '../../../../connectors/http/connection.js';
import { encodeScheduleInputValue } from '../../../../workflow/schedule/input-value.js';
import type { Recurrence } from '../../../../workflow/schedule/recurrence.js';
import { validateWorkflowIR, type WorkflowIR } from '../../../../workflow/schema.js';
import type { AxUiPresentation } from '../schema.js';
import { commandChatContext, connectedService } from './fixtures.js';
import { recurringJobFromExecution } from './from-execution.js';

const monthlyLastDay: Recurrence = {
  kind: 'recurrence', freq: 'monthly', interval: 1, byMonthDay: [-1], times: [{ hour: 18, minute: 0 }],
  anchor: '2026-10-01', timezone: 'Asia/Seoul',
};

function oneOffIr(connectionId: string): WorkflowIR {
  const parsed = validateWorkflowIR({
    version: 1,
    name: '상품 재고 알림',
    goal: 'DummyJSON 상품 중 재고 10 미만을 Slack으로 알려줘',
    trigger: { type: 'manual' },
    steps: [
      { type: 'action', id: 'fetch', connector: 'http', action: 'request', params: { connectionId, method: 'GET', path: 'products' }, sideEffect: 'NONE' },
      {
        type: 'ai_decision', id: 'compose', investigation: false, goal: '재고가 적은 상품을 한국어로 정리한다',
        outputSchema: { type: 'object', properties: { conclusion: { type: 'string', purpose: 'prose' } }, required: ['conclusion'] },
      },
      {
        type: 'action', id: 'notify', connector: 'slack', action: 'message.send', params: { channel: '#ops' }, sideEffect: 'EXTERNAL',
        bindings: { text: { from: 'compose', output: 'conclusion' } },
      },
    ],
  });
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.value;
}

async function withOneOffRun(overrides: { status?: 'success' | 'failed'; sessionId?: string; ephemeral?: boolean } = {}) {
  const context = await connectedService();
  const connectionId = httpEndpointsFromConnections(context.store.getConnections())[0]!.id;
  const ir = oneOffIr(connectionId);
  const executionId = context.store.createExecution({
    ephemeral: overrides.ephemeral ?? true,
    irJson: JSON.stringify(ir),
    workspaceSessionId: overrides.sessionId ?? context.chat.id,
  });
  context.store.finishExecution(executionId, overrides.status ?? 'success');
  return { ...context, ir, executionId };
}

describe('making a one-off run recurring', () => {
  it('proposes the exact steps that ran, on the chosen schedule, behind the confirmation card', async () => {
    const { store, service, chat, ir, executionId } = await withOneOffRun();
    const conversion = recurringJobFromExecution({
      execution: store.getExecution(executionId),
      workspaceSessionId: chat.id,
      scheduleValue: encodeScheduleInputValue(monthlyLastDay),
    });
    expect(conversion.ok ? 'ok' : conversion.message).toBe('ok');
    if (!conversion.ok) return;
    expect(conversion.scheduleText).toBe('매월 마지막 날 오후 6:00');
    expect(conversion.args.steps).toMatchObject(ir.steps);

    const response = await service.execute({ name: 'job.propose', args: conversion.args }, { ...commandChatContext, workspaceSessionId: chat.id });
    expect(response.status).toBe('ok');
    const data = response.data as { saved: boolean; presentation: AxUiPresentation; summary: Record<string, unknown> };
    // Nothing is saved or switched on until the person confirms; sends keep needing approval.
    expect(data.saved).toBe(false);
    expect(data.summary).toMatchObject({ runOnceNow: false, allowExternalAuto: false });
    const text = JSON.stringify(data.presentation);
    expect(text).toContain('일정: 매월 마지막 날 오후 6:00');
    expect(text).toContain('자동 발송: 꺼짐(기본)');
    expect(store.listWorkflowDefinitions()).toHaveLength(0);
  });

  it('saves and switches on the schedule only after the card is confirmed', async () => {
    const { store, service, chat, executionId } = await withOneOffRun();
    const conversion = recurringJobFromExecution({
      execution: store.getExecution(executionId),
      workspaceSessionId: chat.id,
      scheduleValue: encodeScheduleInputValue(monthlyLastDay),
    });
    if (!conversion.ok) throw new Error(conversion.message);
    const proposed = await service.execute({ name: 'job.propose', args: conversion.args }, { ...commandChatContext, workspaceSessionId: chat.id });
    const token = (((proposed.data as { presentation?: AxUiPresentation }).presentation?.actions ?? [])
      .find((action) => action.purpose === 'confirm_job')?.id ?? '').split(':')[1];

    const committed = await service.execute({ name: 'job.commit', args: {} }, {
      ...commandChatContext, workspaceSessionId: chat.id, allowJobCommit: true, jobCommitConfirmationToken: token,
    });
    expect(committed.status).toBe('ok');
    const workflow = store.getWorkflow((committed.data as { workflowId: string }).workflowId);
    expect(workflow?.trigger).toEqual({ type: 'schedule', recurrence: monthlyLastDay, timezone: 'Asia/Seoul' });
    expect(workflow?.steps.map((step) => step.id)).toEqual(['fetch', 'compose', 'notify']);
    expect(workflow?.allowExternalAuto).toBeFalsy();
  });

  it('refuses runs from another conversation, failed runs and saved jobs', async () => {
    const scheduleValue = encodeScheduleInputValue(monthlyLastDay);
    const other = await withOneOffRun({ sessionId: 'another-chat' });
    expect(recurringJobFromExecution({ execution: other.store.getExecution(other.executionId), workspaceSessionId: other.chat.id, scheduleValue }).ok).toBe(false);
    const failed = await withOneOffRun({ status: 'failed' });
    expect(recurringJobFromExecution({ execution: failed.store.getExecution(failed.executionId), workspaceSessionId: failed.chat.id, scheduleValue }).ok).toBe(false);
    const saved = await withOneOffRun({ ephemeral: false });
    expect(recurringJobFromExecution({ execution: saved.store.getExecution(saved.executionId), workspaceSessionId: saved.chat.id, scheduleValue }).ok).toBe(false);
    expect(recurringJobFromExecution({ execution: undefined, workspaceSessionId: 'x', scheduleValue }).ok).toBe(false);
  });

  it('refuses a schedule value without a valid machine token', async () => {
    const { store, chat, executionId } = await withOneOffRun();
    const result = recurringJobFromExecution({ execution: store.getExecution(executionId), workspaceSessionId: chat.id, scheduleValue: '매월 마지막 날 오후 6:00' });
    expect(result).toEqual({ ok: false, message: '반복 일정을 다시 골라 주세요.' });
  });
});

describe('making a read answer recurring', () => {
  it('proposes fetch, table and shaping steps that pass contract checks and save on confirmation', async () => {
    const { recurringJobFromReadRecipe } = await import('./from-execution.js');
    const { store, service, chat } = await connectedService();
    const connectionId = httpEndpointsFromConnections(store.getConnections())[0]!.id;
    const conversion = recurringJobFromReadRecipe({
      recipe: {
        kind: 'http_table',
        params: { connectionId, method: 'GET', path: 'products' },
        rowsPath: 'products',
        expression: {
          op: 'select',
          input: { op: 'filter', input: { op: 'source', sourceId: 'chat:read-result' }, where: { op: 'lt', left: { ref: 'stock' }, right: { lit: 10 } } },
          columns: ['title', 'stock'],
        },
      },
      request: 'DummyJSON 상품 중 재고 10 미만만 표로 보여줘',
      scheduleValue: encodeScheduleInputValue(monthlyLastDay),
    });
    if (!conversion.ok) throw new Error(conversion.message);
    const proposed = await service.execute({ name: 'job.propose', args: conversion.args }, { ...commandChatContext, workspaceSessionId: chat.id });
    expect(proposed.status, JSON.stringify(proposed.issues)).toBe('ok');
    const presentation = (proposed.data as { presentation: AxUiPresentation }).presentation;
    const text = JSON.stringify(presentation);
    expect(text).toContain('일정: 매월 마지막 날 오후 6:00');
    expect(text).toContain('외부 전송 단계가 없습니다.');
    const token = (presentation.actions.find((action) => action.purpose === 'confirm_job')?.id ?? '').split(':')[1];
    const committed = await service.execute({ name: 'job.commit', args: {} }, {
      ...commandChatContext, workspaceSessionId: chat.id, allowJobCommit: true, jobCommitConfirmationToken: token,
    });
    expect(committed.status).toBe('ok');
    const workflow = store.getWorkflow((committed.data as { workflowId: string }).workflowId);
    expect(workflow?.steps.map((step) => step.type === 'action' ? `${step.connector}.${step.action}` : step.type))
      .toEqual(['http.request', 'transform.http_to_table', 'transform.evaluate']);
  });
});
