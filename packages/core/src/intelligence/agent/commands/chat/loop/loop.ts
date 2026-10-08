import { createAuthoritativeRequestAnchor } from '../../../../decision/request-anchor.js';
import type { AxCommandChatOptions } from './contracts.js';
import { chatReplyPrompt, jevUnavailableChatReplyPrompt } from './protocol.js';
import { hostFacingMessage } from '../result/index.js';
import {
  needsExplicitHttpEndpointSelection,
  selectedHttpReadCommand,
} from './connection-selection/http-endpoint-selection.js';
import { chatReadAuthorizationFor } from './read-authorization.js';
import { runHostConfirmedTurn } from './loop-confirmations.js';
import { createChatReplies, type ChatReplies } from './loop-replies.js';
import { runJevChatTurn } from './loop-jev/index.js';
import {
  executeScopedChatCommand,
  presentHttpEndpointSelection,
  type CommandChatLoopContext,
} from './loop-shared.js';
export type { CommandChatLoopContext } from './loop-shared.js';

function shouldUseJevRoute(options: AxCommandChatOptions): boolean {
  return Boolean(options.decisionEngine) && !options.allowJobCommit && !options.mutationConfirmationToken;
}

/** A follow-up that only selects an HTTP connection for the previous explicit GET path. */
async function runSelectedHttpRead(context: CommandChatLoopContext, replies: ChatReplies): Promise<string | undefined> {
  const { options, messages, signal, publishResult } = context;
  const selectedHttpRead = selectedHttpReadCommand(options.userMessage, messages, options.httpEndpoints ?? []);
  if (!selectedHttpRead) return undefined;
  const { command, userIntent } = selectedHttpRead;
  createAuthoritativeRequestAnchor(userIntent, {}, options.requestBudget);
  const readAuthorization = chatReadAuthorizationFor(command, { userText: userIntent });
  const result = await executeScopedChatCommand(context, command, readAuthorization);
  signal.throwIfAborted();
  const resultForLoop = publishResult(command.name, result);
  if (resultForLoop.status !== 'ok') {
    return hostFacingMessage(resultForLoop, 'HTTP 조회를 처리하지 못했습니다.');
  }
  return replies.successfulCommandReply({
    command,
    result: resultForLoop,
    userIntent,
    phase: 'ax_command_chat_selected_http_result',
    fallback: 'HTTP 조회는 처리했지만 결과 설명을 생성하지 못했습니다.',
  });
}

/**
 * One chat turn: host-confirmed continuations first, then an explicit HTTP
 * connection choice, then Jev routing. Without Jev, only a text reply is allowed.
 */
export async function runCommandChatLoop(context: CommandChatLoopContext): Promise<string | undefined> {
  const { options, signal } = context;
  signal.throwIfAborted();
  const confirmed = runHostConfirmedTurn(context);
  if (confirmed) return confirmed;

  // With no Jev engine, an explicit GET/HEAD path can still safely ask the
  // user to choose among endpoints; natural-language routing stays fail-closed.
  if (!options.decisionEngine && needsExplicitHttpEndpointSelection(options.userMessage, options.httpEndpoints ?? [])) {
    return presentHttpEndpointSelection(context);
  }

  const replies = createChatReplies(context);
  const selectedHttpReply = await runSelectedHttpRead(context, replies);
  if (selectedHttpReply !== undefined) return selectedHttpReply;

  if (shouldUseJevRoute(options)) return runJevChatTurn(context, replies);

  const jevUnavailable = !options.decisionEngine;
  const reply = await replies.textReplyFromModel(
    jevUnavailable ? 'ax_command_chat_no_jev' : 'ax_command_chat_text',
    jevUnavailable ? jevUnavailableChatReplyPrompt(options) : chatReplyPrompt(options),
  );
  if (reply) return reply;
  if (jevUnavailable) {
    return '판단 엔진(Jev)이 연결되지 않아 자료 조회나 외부 작업을 하지 않았습니다. 설정 > 판단 엔진에서 연결한 뒤 다시 요청해 주세요.';
  }
  return '요청을 어떻게 처리할지 정하지 못해 아무것도 실행하지 않았습니다. 무엇을(어떤 자료나 업무) 어떻게 하고 싶은지 조금 더 구체적으로 알려 주세요.';
}
