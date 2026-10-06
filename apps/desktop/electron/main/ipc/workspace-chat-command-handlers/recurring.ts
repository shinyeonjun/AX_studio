import { AGENT_COMMAND_CONTEXT, recurringJobFromExecution, type AxUiPresentation } from '@ax-studio/core';
import { getCore } from '../../core-instance.js';
import { ipcHandle } from '../ipc-handle.js';

const SESSION_ID = /^[A-Za-z0-9_-]{1,128}$/;
const EXECUTION_ID = /^[A-Za-z0-9_-]{1,128}$/;
const MAX_SCHEDULE_VALUE_CHARS = 4_000;

export interface RecurringDraftReply {
  role: 'assistant';
  content: string;
  presentations: AxUiPresentation[];
}

function reply(content: string, presentations: AxUiPresentation[] = []): RecurringDraftReply {
  return { role: 'assistant', content, presentations };
}

/**
 * "이걸 반복 업무로": a finished one-off run of this conversation becomes a job draft on the
 * chosen schedule. Only the draft and its confirmation card are produced here; saving and
 * switching it on stays behind the card's own confirmation, like any other job proposal.
 */
export async function proposeRecurringFromExecution(
  workspaceSessionId: unknown,
  executionId: unknown,
  scheduleValue: unknown,
): Promise<RecurringDraftReply> {
  if (typeof workspaceSessionId !== 'string' || !SESSION_ID.test(workspaceSessionId)) throw new Error('대화 세션 id 형식이 올바르지 않습니다.');
  if (typeof executionId !== 'string' || !EXECUTION_ID.test(executionId)) throw new Error('실행 id 형식이 올바르지 않습니다.');
  if (typeof scheduleValue !== 'string' || !scheduleValue.trim() || scheduleValue.length > MAX_SCHEDULE_VALUE_CHARS) {
    throw new Error('반복 일정 형식이 올바르지 않습니다.');
  }
  const core = getCore();
  if (!core.store.getWorkspaceChat(workspaceSessionId)) throw new Error('대화를 찾을 수 없습니다.');
  const conversion = recurringJobFromExecution({
    execution: core.store.getExecution(executionId),
    workspaceSessionId,
    scheduleValue,
  });
  if (!conversion.ok) return reply(conversion.message);
  const result = await core.commandService.execute(
    { name: 'job.propose', args: conversion.args },
    { executionContext: AGENT_COMMAND_CONTEXT, workspaceSessionId },
  );
  const data = result.data as { presentation?: AxUiPresentation } | undefined;
  if (result.status === 'ok' && data?.presentation) {
    return reply(`방금 한 작업을 ${conversion.scheduleText}에 반복하는 업무 초안입니다. 내용을 확인한 뒤 저장해 주세요.`, [data.presentation]);
  }
  const reasons = (result.issues ?? []).map((issue) => issue.message).filter(Boolean);
  return reply(`반복 업무 초안을 만들지 못했습니다.${reasons.length ? ` ${reasons.join(' ')}` : ''}`);
}

export function registerRecurringDraftHandler(): void {
  ipcHandle('ax:proposeRecurringFromExecution', async (_event, workspaceSessionId: unknown, executionId: unknown, scheduleValue: unknown) =>
    proposeRecurringFromExecution(workspaceSessionId, executionId, scheduleValue));
}
