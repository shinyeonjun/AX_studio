import type { ChatMessage } from '../model/chat.js';
import type { AxCommand, AxCommandResult } from './schema.js';
import { inputRequestsForResult } from './input-requests.js';
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
 * Desktop chat uses Jev for bounded intent and route decisions. The host
 * validates and executes selected commands; the text model only writes replies.
 */
export const AX_COMMAND_CHAT_TIMEOUT_MS = 120_000;

function configuredModelReply(userMessage: string, harness: AxCommandChatOptions['harness']): string | undefined {
  const text = userMessage.trim().replace(/[!?！？。]+$/gu, '').replace(/\s+/g, ' ');
  if (text.length > 80) return undefined;
  // Model identity is host configuration, not something the LLM should guess.
  if (/^(?:너의|네|현재)\s*모델(?:은|이|을)?\s*(?:뭐|무엇)(?:야|냐|지)?$/u.test(text)
    || /^(?:어떤|무슨)\s*모델(?:을)?\s*(?:써|사용해)(?:요)?$/u.test(text)) {
    const model = harness.modelName?.trim();
    const label = model ? `${harness.providerName} / ${model}` : harness.providerName;
    return `현재 연결된 모델은 ${label}입니다. 답변은 이 모델이 만들고, 실제 조회·실행은 AX Studio host와 Runtime이 담당합니다.`;
  }
  return undefined;
}

/**
 * Runs the Desktop chat loop. Jev selects from bounded host-generated options;
 * the text model only writes replies from the conversation and executed results.
 */
export async function runAxCommandChat(options: AxCommandChatOptions): Promise<string> {
  const startedAt = Date.now();
  const requestContext = options.requestId ? { requestId: options.requestId } : {};
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
  const publishResult = (commandName: string, result: AxCommandResult, command?: AxCommand) => {
    const inputRequests = inputRequestsForResult(result);
    const resultForLoop: AxCommandResult = { ...result, inputRequests };
    options.onCommandResult?.(resultForLoop, command);
    options.onInputRequests?.(inputRequests);
    const presentation = presentationFromResult(commandName, resultForLoop);
    if (presentation) options.onPresentation?.(presentation);
    applyCommandResultToSession(commandName, resultForLoop, session);
    return resultForLoop;
  };

  try {
    if (controller.signal.aborted) throw new Error('ax_command_chat_timeout');
    if (!options.pendingCommand && !options.contextUpdateConfirmation && !options.allowJobCommit) {
      const modelReply = configuredModelReply(options.userMessage, options.harness);
      if (modelReply) {
        appendAppLog('info', 'Chat reported configured model metadata without model generation.', {
          ...requestContext,
          event: 'chat_model_metadata_fast_path',
          durationMs: Date.now() - startedAt,
          jevCalls: 0,
          llmCalls: 0,
          replyChars: modelReply.length,
        });
        return modelReply;
      }
    }
    const messages: ChatMessage[] = [
      ...options.messages,
      { role: 'user', content: options.userMessage },
    ];
    const loopResult = await runCommandChatLoop({
      options,
      messages,
      session,
      signal: controller.signal,
      publishResult,
    });
    controller.signal.throwIfAborted();
    if (loopResult !== undefined) return loopResult;
  } catch (error) {
    appendAppLog('error', error instanceof Error ? error.message : String(error), {
      ...requestContext,
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

  appendAppLog('warn', 'Jev chat route returned no result.', { ...requestContext, event: 'jev_chat_empty_result' });
  return '요청을 안전한 실행 경로로 처리하지 못했습니다. Jev 연결을 확인하고 다시 요청해 주세요.';
}
