import type { ChatMessage } from '../model/chat.js';
import type { AxCommandResult } from './schema.js';
import { inputRequestsForResult } from './input-requests.js';
import { createAxCommandChatTransport } from './transport.js';
import { appendAppLog } from '../../../persistence/paths/app-log.js';
import type { AxCommandChatOptions } from './chat/contracts.js';
import {
  applyCommandResultToSession,
  presentationFromResult,
  type CommandChatSessionState,
} from './chat/result.js';
import { runCommandChatLoop } from './chat/loop.js';

export type { AxCommandChatOptions } from './chat/contracts.js';

/**
 * The model-facing protocol has only two outcomes: request one bounded AX
 * command, or answer the user. Command execution is owned by the host.
 */
// Multi-source requests may need to inspect attached documents, identify
// connected sources, read each source, and then submit one bounded plan. Keep
// the budget finite, but leave room for the final reply after those reads.
export const AX_COMMAND_CHAT_MAX_ROUNDS = 16;
export const AX_COMMAND_CHAT_TIMEOUT_MS = 120_000;

function quickChatReply(userMessage: string, harness: AxCommandChatOptions['harness']): string | undefined {
  const text = userMessage.trim().replace(/[!?！？。]+$/gu, '').replace(/\s+/g, ' ');
  if (text.length > 80) return undefined;
  if (/^(안녕|안녕하세요|ㅎㅇ|하이|hello|hi)$/iu.test(text)) {
    return '안녕하세요. AX Studio 업무 후임 에이전트입니다. 조회·실행·반복 업무를 도와드릴게요.';
  }
  if (/^(?:너는|넌|당신은)?\s*누구(?:야|냐|지)?$/u.test(text)) {
    return 'AX Studio의 업무 후임 에이전트입니다. 요청을 이해하고, 필요한 조회와 실행은 host와 Runtime을 통해 처리합니다.';
  }
  if (/^(?:너의|네|현재)\s*모델(?:은|이|을)?\s*(?:뭐|무엇)(?:야|냐|지)?$/u.test(text)
    || /^(?:어떤|무슨)\s*모델(?:을)?\s*(?:써|사용해)(?:요)?$/u.test(text)) {
    const model = harness.modelName?.trim();
    const label = model ? `${harness.providerName} / ${model}` : harness.providerName;
    return `현재 연결된 모델은 ${label}입니다. 답변은 이 모델이 만들고, 실제 조회·실행은 AX Studio host와 Runtime이 담당합니다.`;
  }
  return undefined;
}

/**
 * Runs a bounded command/reply loop. The model never receives a host object
 * or a tool callback; it receives only the command contract and prior results.
 */
export async function runAxCommandChat(options: AxCommandChatOptions): Promise<string> {
  const providerName = options.harness.providerName;
  const controller = new AbortController();
  const timeoutMs = options.timeoutMs ?? AX_COMMAND_CHAT_TIMEOUT_MS;
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const abortExternal = () => controller.abort();
  if (options.abortSignal?.aborted) {
    abortExternal();
  } else {
    options.abortSignal?.addEventListener('abort', abortExternal, { once: true });
  }

  const session: CommandChatSessionState = {
    workflowId: options.currentWorkflowId?.trim() || undefined,
    sessionMemo: options.sessionMemo ?? {},
    workflowPolicy: options.workflowPolicy ?? {},
  };
  const publishResult = (commandName: string, result: AxCommandResult) => {
    const inputRequests = inputRequestsForResult(result);
    const resultForLoop: AxCommandResult = { ...result, inputRequests };
    options.onCommandResult?.(resultForLoop);
    options.onInputRequests?.(inputRequests);
    const presentation = presentationFromResult(commandName, resultForLoop);
    if (presentation) options.onPresentation?.(presentation);
    applyCommandResultToSession(commandName, resultForLoop, session);
    return resultForLoop;
  };

  try {
    if (controller.signal.aborted) throw new Error('ax_command_chat_timeout');
    if (!options.allowContextUpdate && !options.allowJobCommit) {
      const quickReply = quickChatReply(options.userMessage, options.harness);
      if (quickReply) return quickReply;
    }
    const transport = createAxCommandChatTransport(providerName);
    const messages: ChatMessage[] = [
      ...options.messages,
      { role: 'user', content: options.userMessage },
    ];
    const loopResult = await runCommandChatLoop({
      options,
      transport,
      messages,
      session,
      signal: controller.signal,
      maxRounds: AX_COMMAND_CHAT_MAX_ROUNDS,
      publishResult,
    });
    controller.signal.throwIfAborted();
    if (loopResult !== undefined) return loopResult;
  } catch (error) {
    appendAppLog('error', error instanceof Error ? error.message : String(error), {
      event: 'command_chat_failed',
    });
    if (controller.signal.aborted) {
      throw new Error(
        options.abortSignal?.aborted
          ? '요청이 취소되었습니다.'
          : 'AI 응답이 제한 시간을 초과했습니다. 잠시 후 다시 시도해 주세요.',
      );
    }
    throw error;
  } finally {
    clearTimeout(timer);
    options.abortSignal?.removeEventListener('abort', abortExternal);
  }

  appendAppLog('warn', 'command chat hit max rounds', { rounds: AX_COMMAND_CHAT_MAX_ROUNDS });
  return '업무 명령을 처리하는 동안 단계가 너무 많아졌습니다. 마지막 요청을 조금 더 구체적으로 보내 주세요.';
}
