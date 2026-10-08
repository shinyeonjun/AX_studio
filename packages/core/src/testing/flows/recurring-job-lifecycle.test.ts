import { mkdtempSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAxStudioCore, type AxStudioCore } from '../../application/bootstrap.js';
import { HttpConnector } from '../../connectors/http/connector.js';
import { httpEndpointsFromConnections } from '../../connectors/http/connection.js';
import { recurringJobFromReadRecipe } from '../../intelligence/agent/commands/job-registration/from-execution.js';
import type { AxUiPresentation } from '../../intelligence/agent/commands/schema.js';
import { MockSlackConnector } from '../connectors/mocks/slack.js';
import { encodeScheduleInputValue } from '../../workflow/schedule/input-value.js';
import type { Recurrence } from '../../workflow/schedule/recurrence.js';

/**
 * One whole recurring job, with nothing between the steps faked: a read answer becomes a job
 * proposal, the person confirms the card, the job is saved, the scheduler finds it on its own at
 * the scheduled minute, the runtime reads the (local) API, and the table lands in the chat that
 * made the job. Each step is tested alone elsewhere; this proves they fit together.
 */

const DAILY_9AM: Recurrence = {
  kind: 'recurrence', freq: 'daily', interval: 1, times: [{ hour: 9, minute: 0 }],
  anchor: '2026-10-01', timezone: 'Asia/Seoul',
};
/** 09:00 in Seoul. */
const NINE_AM_SEOUL = new Date('2026-10-08T00:00:20Z');

const PRODUCTS = {
  products: [
    { id: 1, title: '무선 마우스', stock: 3 },
    { id: 2, title: '키보드', stock: 42 },
    { id: 3, title: '모니터 받침', stock: 7 },
  ],
};

let server: Server;
let baseUrl: string;
let requests = 0;
let dataRoot: string;
let core: AxStudioCore | undefined;

beforeEach(async () => {
  requests = 0;
  server = createServer((_request, response) => {
    requests += 1;
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify(PRODUCTS));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
  dataRoot = mkdtempSync(join(tmpdir(), 'ax-flow-recurring-'));
  vi.useFakeTimers({ toFake: ['Date'] });
});

afterEach(async () => {
  vi.useRealTimers();
  await core?.scheduler.stop();
  core?.db.close?.();
  core = undefined;
  rmSync(dataRoot, { recursive: true, force: true });
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

async function startCore(events: Array<{ sessionId: string; workflowId?: string; executionId: string }>) {
  core = await createAxStudioCore({ dataRoot, onWorkspaceChatChanged: (event) => events.push(event) });
  core.store.setConnection('http', true, { endpoints: [{ id: 'shop', baseUrl, label: '쇼핑몰 API', authType: 'none' }] });
  // The desktop installs the connector from the saved connection; the test server is local.
  core.runtime.connectors.http = new HttpConnector(httpEndpointsFromConnections(core.store.getConnections()), { allowPrivateNetwork: true });
  return core;
}

async function tick(target: AxStudioCore) {
  await (target.scheduler as unknown as { tick(): Promise<void> }).tick();
}

/** Proposes the low-stock table as a daily job and confirms the card, as the chat does. */
async function proposeAndConfirm(target: AxStudioCore, chatId: string, scheduleValue: string) {
  const connectionId = httpEndpointsFromConnections(target.store.getConnections())[0]!.id;
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
    request: '쇼핑몰 상품 중 재고 10개 미만만 표로 보여줘',
    scheduleValue,
  });
  if (!conversion.ok) throw new Error(conversion.message);
  const context = { executionContext: { origin: 'agent' as const }, workspaceSessionId: chatId };
  const proposed = await target.commandService.execute({ name: 'job.propose', args: conversion.args }, context);
  expect(proposed.status, JSON.stringify(proposed.issues)).toBe('ok');
  const card = (proposed.data as { presentation: AxUiPresentation }).presentation;
  const token = card.actions.find((action) => action.purpose === 'confirm_job')?.id.split(':')[1];
  const committed = await target.commandService.execute({ name: 'job.commit', args: {} }, {
    ...context, allowJobCommit: true, jobCommitConfirmationToken: token,
  });
  expect(committed.status, JSON.stringify(committed.issues)).toBe('ok');
  return (committed.data as { workflowId: string }).workflowId;
}

describe('a recurring job from proposal to its first scheduled run', () => {
  it('runs at the scheduled minute without any extra registration and posts the table to the chat that made it', async () => {
    vi.setSystemTime(new Date('2026-10-08T00:30:00Z'));
    const events: Array<{ sessionId: string; workflowId?: string; executionId: string }> = [];
    const target = await startCore(events);
    const chat = target.store.saveWorkspaceChat({ messages: [{ role: 'user', content: '쇼핑몰 상품 중 재고 10개 미만만 표로 보여줘' }] });

    const workflowId = await proposeAndConfirm(target, chat.id, encodeScheduleInputValue(DAILY_9AM));
    expect(target.store.isWorkflowActive(workflowId)).toBe(true);
    expect(target.store.getWorkspaceChat(chat.id)?.workflowId).toBe(workflowId);

    // 09:30 Seoul: today's 09:00 already passed before the job existed, so nothing runs.
    await tick(target);
    expect(requests).toBe(0);

    vi.setSystemTime(new Date(NINE_AM_SEOUL.getTime() + 24 * 60 * 60 * 1000));
    await tick(target);

    expect(requests).toBe(1);
    const executions = target.store.listExecutions().filter((execution) => execution.workflowId === workflowId);
    expect(executions.map((execution) => [execution.status, execution.triggerType])).toEqual([['success', 'schedule']]);
    expect(events).toEqual([{ sessionId: chat.id, workflowId, executionId: executions[0]!.id }]);
    const posted = target.store.getWorkspaceChat(chat.id)?.messages.find((message) => message.kind === 'execution_result');
    expect(posted).toMatchObject({ executionId: executions[0]!.id, executionStatus: 'success' });
    expect(JSON.stringify(posted?.readResult)).toContain('무선 마우스');
    expect(JSON.stringify(posted?.readResult)).not.toContain('키보드');

    // The same minute is never run twice.
    await tick(target);
    expect(requests).toBe(1);
  });
});

describe('a scheduled send waits for approval and sends once after it', () => {
  it('pauses at the send, appears on the approvals page, holds later occurrences, and sends once on approve', async () => {
    vi.setSystemTime(new Date('2026-10-08T00:30:00Z'));
    const events: Array<{ sessionId: string; workflowId?: string; executionId: string }> = [];
    const target = await startCore(events);
    const slack = new MockSlackConnector();
    target.runtime.connectors.slack = slack;
    target.store.setConnection('slack', true);
    const chat = target.store.saveWorkspaceChat({ messages: [{ role: 'user', content: '매일 9시에 슬랙으로 출근 알림 보내줘' }] });
    const context = { executionContext: { origin: 'agent' as const }, workspaceSessionId: chat.id };
    const proposed = await target.commandService.execute({ name: 'job.propose', args: {
      name: '출근 알림', goal: '매일 9시에 슬랙으로 출근 알림을 보낸다',
      trigger: { type: 'schedule', recurrence: DAILY_9AM, timezone: 'Asia/Seoul' },
      steps: [{ type: 'action', id: 'notify', connector: 'slack', action: 'message.send', params: { channel: '#ax테스트', text: '좋은 아침입니다' } }],
      runOnceNow: false, allowExternalAuto: false,
    } }, context);
    expect(proposed.status, JSON.stringify(proposed.issues)).toBe('ok');
    const token = (proposed.data as { presentation: AxUiPresentation }).presentation.actions
      .find((action) => action.purpose === 'confirm_job')?.id.split(':')[1];
    const committed = await target.commandService.execute({ name: 'job.commit', args: {} }, { ...context, allowJobCommit: true, jobCommitConfirmationToken: token });
    expect(committed.status, JSON.stringify(committed.issues)).toBe('ok');
    const workflowId = (committed.data as { workflowId: string }).workflowId;

    vi.setSystemTime(new Date(NINE_AM_SEOUL.getTime() + 24 * 60 * 60 * 1000));
    await tick(target);

    const [execution] = target.store.listExecutions().filter((entry) => entry.workflowId === workflowId);
    expect(execution?.status).toBe('pending_approval');
    expect(slack.messages).toHaveLength(0);
    // Scheduled runs are not edited in the chat; the approvals page approves them as they are.
    const approval = target.store.getPendingApprovalsWithExecutionSnapshots()[0]?.approval;
    expect(approval?.executionId).toBe(execution!.id);
    expect(target.runtime.getToolResult(approval!.id)).toBeUndefined();
    expect(target.runtime.requiresToolResultReview(approval!.id)).toBe(false);
    expect(target.store.getWorkspaceChat(chat.id)?.messages.find((message) => message.kind === 'execution_result'))
      .toMatchObject({ executionId: execution!.id, executionStatus: 'pending_approval' });

    // The next morning comes while the first is still waiting: no second run piles up.
    vi.setSystemTime(new Date(NINE_AM_SEOUL.getTime() + 2 * 24 * 60 * 60 * 1000));
    await tick(target);
    expect(target.store.listExecutions().filter((entry) => entry.workflowId === workflowId)).toHaveLength(1);

    const approved = await target.runtime.continueAfterApproval(approval!.id);
    expect(approved.status).toBe('success');
    expect(slack.messages).toEqual([expect.objectContaining({ channel: '#ax테스트', text: '좋은 아침입니다' })]);
    expect(target.store.getApproval(approval!.id)?.status).toBe('approved');
    expect(target.store.getWorkspaceChat(chat.id)?.messages.filter((message) => message.kind === 'execution_result'))
      .toEqual([expect.objectContaining({ executionId: execution!.id, executionStatus: 'success' })]);

    // Approving twice never sends twice.
    const again = await target.runtime.continueAfterApproval(approval!.id);
    expect(again.status).not.toBe('success');
    expect(slack.messages).toHaveLength(1);
  });
});

describe('a job on a short schedule in its chat', () => {
  it('keeps the latest result instead of a pile, and starts a new one after the person speaks', async () => {
    vi.setSystemTime(new Date('2026-10-08T00:01:00Z'));
    const target = await startCore([]);
    const chat = target.store.saveWorkspaceChat({ messages: [{ role: 'user', content: '재고 10개 미만 상품 보여줘' }] });
    const every5: Recurrence = { kind: 'recurrence', freq: 'minutely', interval: 5, anchor: '2026-10-08', timezone: 'Asia/Seoul' };
    const workflowId = await proposeAndConfirm(target, chat.id, encodeScheduleInputValue(every5));
    const results = () => (target.store.getWorkspaceChat(chat.id)?.messages ?? []).filter((message) => message.kind === 'execution_result');
    const runIds = () => target.store.listExecutions().filter((execution) => execution.workflowId === workflowId).map((execution) => execution.id);

    vi.setSystemTime(new Date('2026-10-08T00:05:10Z'));
    await tick(target);
    vi.setSystemTime(new Date('2026-10-08T00:10:10Z'));
    await tick(target);
    expect(runIds()).toHaveLength(2);
    expect(results().map((message) => message.executionId)).toEqual([runIds()[0]]);

    const now = target.store.getWorkspaceChat(chat.id)!;
    target.store.saveWorkspaceChat({ id: chat.id, messages: [...now.messages, { role: 'user', content: '고마워' }] });
    vi.setSystemTime(new Date('2026-10-08T00:15:10Z'));
    await tick(target);
    expect(results()).toHaveLength(2);
  });
});
