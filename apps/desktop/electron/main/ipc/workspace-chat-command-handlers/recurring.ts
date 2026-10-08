import {
  AGENT_COMMAND_CONTEXT,
  recurringJobFromExecution,
  recurringJobFromReadRecipe,
  hostReadRecipeFor,
  suggestWorkName,
  withoutScheduleTokens,
  type AxUiPresentation,
  type WorkspaceChatMessage,
} from '@ax-studio/core';
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
  if (typeof workspaceSessionId !== 'string' || !SESSION_ID.test(workspaceSessionId)) throw new Error('대화를 찾을 수 없어요. 화면을 새로고침해 주세요.');
  if (typeof executionId !== 'string' || !EXECUTION_ID.test(executionId)) throw new Error('실행 기록을 찾을 수 없어요. 화면을 새로고침해 주세요.');
  if (typeof scheduleValue !== 'string' || !scheduleValue.trim() || scheduleValue.length > MAX_SCHEDULE_VALUE_CHARS) {
    throw new Error('반복 일정을 이해하지 못했어요. 일정을 다시 골라 주세요.');
  }
  const core = getCore();
  if (!core.store.getWorkspaceChat(workspaceSessionId)) throw new Error('대화를 찾을 수 없어요. 이미 삭제됐을 수 있어요.');
  const conversion = recurringJobFromExecution({
    execution: core.store.getExecution(executionId),
    workspaceSessionId,
    scheduleValue,
  });
  if (!conversion.ok) return reply(conversion.message);
  return proposeDraft(workspaceSessionId, conversion.args, conversion.scheduleText, '방금 한 작업을');
}

async function proposeDraft(
  workspaceSessionId: string,
  args: Record<string, unknown>,
  scheduleText: string,
  subject: string,
): Promise<RecurringDraftReply> {
  const result = await getCore().commandService.execute(
    { name: 'job.propose', args },
    { executionContext: AGENT_COMMAND_CONTEXT, workspaceSessionId },
  );
  const data = result.data as { presentation?: AxUiPresentation } | undefined;
  if (result.status === 'ok' && data?.presentation) {
    return reply(`${subject} 반복하는 업무 초안이에요. 일정은 ${scheduleText}이고, 내용을 확인한 뒤 저장해 주세요.`, [data.presentation]);
  }
  const reasons = (result.issues ?? []).map((issue) => issue.message).filter(Boolean);
  return reply(`반복 업무 초안을 만들지 못했습니다.${reasons.length ? ` ${reasons.join(' ')}` : ''}`);
}

/** The person's request answered by the latest read answer in the transcript. */
function requestForLatestRead(messages: WorkspaceChatMessage[]): string {
  let answerIndex = messages.length - 1;
  while (answerIndex >= 0 && !(messages[answerIndex]!.role === 'assistant' && messages[answerIndex]!.readResult)) answerIndex -= 1;
  for (let index = answerIndex - 1; index >= 0; index -= 1) {
    const message = messages[index]!;
    if (message.role === 'user') return withoutScheduleTokens(message.content).trim();
  }
  return '';
}

/**
 * "이걸 반복 업무로" under a read answer: the host-remembered recipe of the latest table shown in
 * this conversation (never anything the renderer sends) becomes a job draft on the chosen schedule.
 */
export async function proposeRecurringFromRead(
  workspaceSessionId: unknown,
  scheduleValue: unknown,
): Promise<RecurringDraftReply> {
  if (typeof workspaceSessionId !== 'string' || !SESSION_ID.test(workspaceSessionId)) throw new Error('대화를 찾을 수 없어요. 화면을 새로고침해 주세요.');
  if (typeof scheduleValue !== 'string' || !scheduleValue.trim() || scheduleValue.length > MAX_SCHEDULE_VALUE_CHARS) {
    throw new Error('반복 일정을 이해하지 못했어요. 일정을 다시 골라 주세요.');
  }
  const chat = getCore().store.getWorkspaceChat(workspaceSessionId);
  if (!chat) throw new Error('대화를 찾을 수 없어요. 이미 삭제됐을 수 있어요.');
  const request = requestForLatestRead(chat.messages);
  const recipe = hostReadRecipeFor(getCore().store, workspaceSessionId, chat.messages);
  // Named for what it does ("반품 주문 확인"), not after the sentence that asked for it.
  const name = recipe ? await suggestWorkName(getCore().agentHarness, request) : undefined;
  const conversion = recurringJobFromReadRecipe({ recipe, request, ...(name ? { name } : {}), scheduleValue });
  if (!conversion.ok) return reply(conversion.message);
  return proposeDraft(workspaceSessionId, conversion.args, conversion.scheduleText, '이 조회를');
}

export function registerRecurringDraftHandler(): void {
  ipcHandle('ax:proposeRecurringFromExecution', async (_event, workspaceSessionId: unknown, executionId: unknown, scheduleValue: unknown) =>
    proposeRecurringFromExecution(workspaceSessionId, executionId, scheduleValue));
  ipcHandle('ax:proposeRecurringFromRead', async (_event, workspaceSessionId: unknown, scheduleValue: unknown) =>
    proposeRecurringFromRead(workspaceSessionId, scheduleValue));
}
