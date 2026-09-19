import type { ChatMessage } from '../../model/chat.js';
import type { AxCommandChatOptions } from './contracts.js';
import type { AxCommand, AxCommandName, AxCommandResult } from '../schema.js';
import type { AxCommandChatTransport } from '../transport-contract.js';
import { AGENT_COMMAND_CONTEXT } from '../access.js';
import {
  commandContext,
  commandProtocolPrompt,
  compactModelMessages,
  chatReplyPrompt,
  protocolFailureMessage,
  protocolRecoveryMessage,
  resultMessage,
} from './protocol.js';
import {
  deterministicHttpChatReply,
  deterministicCapabilityReadChatReply,
  hostFacingMessage,
  type CommandChatSessionState,
} from './result.js';
import { routeChatWithJev } from './jev-router.js';
import { appendAppLog } from '../../../../persistence/paths/app-log.js';
import { gateChatCommandWithJev } from './jev-command-gate.js';
import { issue as commandIssue, result as commandResult } from '../contract.js';

const MAX_PROTOCOL_RECOVERY_ATTEMPTS = 1;
// Keep nouns out of this fast path. They describe a topic, not an action, and
// routing questions such as "API가 뭐야?" through Jev adds latency for no
// safety benefit. Imperative/action wording still reaches the bounded router.
const JEV_ACTION_HINT = /조회|검색|읽|가져|호출|요청|실행|돌려|시작|만들|생성|저장|예약|반복|삭제|수정|변경|연결|보여|목록|확인|정리|추천|분석|\b(?:run|execute|get|post|delete|show|list|call)\b/iu;
const JEV_CONCEPTUAL_HINT = /(?:뭐\s*(?:야|냐)|무엇|차이|뜻|의미|왜\s|어떻게\s)/iu;
const JEV_DIRECT_ACTION_HINT = /(?:조회|검색|읽|가져|호출|요청|실행|돌려|시작|만들|생성|저장|예약|삭제|수정|변경|연결|보여|확인|정리|추천|분석)(?:해|하|할|하고|해서|해줘|해주세요|해봐|해볼|할래|할까)/iu;

function shouldUseJevRoute(options: AxCommandChatOptions): boolean {
  if (options.allowContextUpdate || options.allowJobCommit) return true;
  const userMessage = options.userMessage.trim();
  if (JEV_ACTION_HINT.test(userMessage)
    && (!JEV_CONCEPTUAL_HINT.test(userMessage) || JEV_DIRECT_ACTION_HINT.test(userMessage))) return true;
  return options.messages.some((message) =>
    message.role === 'assistant' && (message.content.includes('AX command result') || message.content.includes('"kind":"command"')),
  );
}

export interface CommandChatLoopContext {
  readonly options: AxCommandChatOptions;
  readonly transport: AxCommandChatTransport;
  readonly messages: ChatMessage[];
  readonly session: CommandChatSessionState;
  readonly signal: AbortSignal;
  readonly maxRounds: number;
  readonly publishResult: (commandName: string, result: AxCommandResult) => AxCommandResult;
}

export async function runCommandChatLoop({
  options,
  transport,
  messages,
  session,
  signal,
  maxRounds,
  publishResult,
}: CommandChatLoopContext): Promise<string | undefined> {
  signal.throwIfAborted();
  if (options.allowJobCommit) {
    const result = await options.commandService.execute({ name: 'job.commit', args: {} }, {
      executionContext: AGENT_COMMAND_CONTEXT,
      workspaceSessionId: options.workspaceSessionId,
      allowJobCommit: true,
      abortSignal: signal,
    });
    signal.throwIfAborted();
    return hostFacingMessage(publishResult('job.commit', result), '업무를 저장하지 못했습니다.');
  }

  let protocolRecoveryAttempts = 0;
  const retryProtocolResponse = (): boolean => {
    if (protocolRecoveryAttempts >= MAX_PROTOCOL_RECOVERY_ATTEMPTS) return false;
    protocolRecoveryAttempts += 1;
    messages.push(
      { role: 'assistant', content: 'AX protocol response was rejected by the host; no command was executed.' },
      { role: 'user', content: protocolRecoveryMessage() },
    );
    return true;
  };

  const semanticGateMessage = async (command: AxCommand): Promise<string | undefined> => {
    const definition = options.commandService
      .listCommands(AGENT_COMMAND_CONTEXT)
      .find((entry) => entry.name === command.name);
    if (!options.decisionEngine || !definition?.mutates) return undefined;
    if (options.allowContextUpdate && command.name === 'context.update') return undefined;

    const gate = await gateChatCommandWithJev({
      decisionEngine: options.decisionEngine,
      userMessage: options.userMessage,
      command,
      definition,
      currentWorkflowId: session.workflowId,
      abortSignal: signal,
    });
    if (gate.allowed) return undefined;

    appendAppLog('warn', 'Jev mutation intent gate blocked a command.', {
      event: 'jev_command_gate_blocked',
      command: command.name,
      reason: gate.reason,
    });
    const message = gate.reason === 'service_unavailable'
      ? '의미 판단 서비스를 확인할 수 없어 변경 작업을 실행하지 않았습니다. 잠시 후 다시 시도해 주세요.'
      : '사용자 요청과 실행 작업의 의미가 명확히 일치하지 않아 실행하지 않았습니다. 대상과 원하는 작업을 구체적으로 알려 주세요.';
    const blocked = commandResult(
      command.name,
      'needs_input',
      undefined,
      [commandIssue('semantic_confirmation_required', message)],
    );
    return hostFacingMessage(publishResult(command.name, blocked), message);
  };

  const textReplyFromModel = async (phase: string): Promise<string | undefined> => {
    try {
      const reply = await options.harness.runText({
        role: 'command',
        systemPrompt: chatReplyPrompt(),
        context: commandContext(options),
        messages: compactModelMessages(messages, options.userMessage),
        sessionId: options.providerSessionId,
        onProgress: options.onProgress,
        logContext: phase,
        abortSignal: signal,
      });
      const output = reply.output.trim();
      if (!output) return undefined;
      appendAppLog('info', 'Chat received a text-only reply.', {
        event: 'chat_reply_generated',
        phase,
        provider: reply.provider,
      });
      return output;
    } catch (error) {
      signal.throwIfAborted();
      appendAppLog('warn', 'Chat text reply could not be generated; falling back to the command model.', {
        event: 'chat_text_reply_fallback',
        phase,
        error: error instanceof Error ? error.message : String(error),
      });
      return undefined;
    }
  };

  const useJevRoute = shouldUseJevRoute(options);
  if (!useJevRoute) {
    const reply = await textReplyFromModel('ax_command_chat_text');
    if (reply) return reply;
  }

  let delegatedCommandNames: readonly AxCommandName[] | undefined;
  if (options.decisionEngine && !options.allowContextUpdate && useJevRoute) {
    const jevStartedAt = Date.now();
    let jevRoute: Awaited<ReturnType<typeof routeChatWithJev>>;
    let jevRouteOutcome = 'error';
    try {
      jevRoute = await routeChatWithJev({
        decisionEngine: options.decisionEngine,
        userMessage: options.userMessage,
        currentWorkflowId: session.workflowId,
        hasWorkspaceSession: Boolean(options.workspaceSessionId),
        connectedConnectors: options.connectedConnectors,
        httpEndpoints: options.httpEndpoints,
        readOperationHints: options.readOperationHints,
        workspaceSources: options.workspaceSources,
        abortSignal: signal,
      });
      jevRouteOutcome = jevRoute.kind === 'fallback'
        ? `fallback:${jevRoute.reason}`
        : `${jevRoute.kind}:${jevRoute.route}`;
    } finally {
      appendAppLog('info', 'Jev chat route timing recorded.', {
        event: 'jev_chat_route_timing',
        durationMs: Date.now() - jevStartedAt,
        outcome: jevRouteOutcome,
        readOperationHintCount: options.readOperationHints?.length ?? 0,
      });
    }
    if (jevRoute.kind === 'fallback') {
      appendAppLog('info', 'Jev chat route fell back to the LLM command path.', {
        event: 'jev_chat_route_fallback',
        reason: jevRoute.reason,
      });
    }
    if (jevRoute.kind === 'reply') {
      const reply = await textReplyFromModel('ax_command_chat_jev_reply');
      if (reply) return reply;
    }
    if (jevRoute.kind === 'delegate') {
      delegatedCommandNames = jevRoute.allowedCommandNames;
      appendAppLog('info', 'Jev fixed the chat command lifecycle before payload generation.', {
        event: 'jev_chat_route_delegated',
        route: jevRoute.route,
        confidence: jevRoute.confidence,
      });
    }
    if (jevRoute.kind === 'command') {
      appendAppLog('info', 'Jev selected a bounded chat route.', {
        event: 'jev_chat_route_selected',
        route: jevRoute.route,
        command: jevRoute.command.name,
        confidence: jevRoute.confidence,
        ...(jevRoute.command.name === 'capability.invoke' && typeof jevRoute.command.args.id === 'string'
          ? { capabilityId: jevRoute.command.args.id.slice(0, 256) }
          : {}),
      });
      const blockedMessage = await semanticGateMessage(jevRoute.command);
      if (blockedMessage) return blockedMessage;
      const result = await options.commandService.execute(jevRoute.command, {
        executionContext: AGENT_COMMAND_CONTEXT,
        userMessage: options.userMessage,
        workspaceSessionId: options.workspaceSessionId,
        currentWorkflowId: session.workflowId,
        abortSignal: signal,
        designToolContext: options.designToolContext,
        designToolContextFactory: options.designToolContextFactory,
      });
      signal.throwIfAborted();
      const resultForLoop = publishResult(jevRoute.command.name, result);
      appendAppLog('info', 'Jev-selected chat route completed.', {
        event: 'jev_chat_route_result',
        route: jevRoute.route,
        command: jevRoute.command.name,
        status: resultForLoop.status,
      });
      if (jevRoute.command.name === 'workflow.run') {
        return hostFacingMessage(resultForLoop, '워크플로우 실행 요청을 처리하지 못했습니다.');
      }
      // Execution status and host issues are deterministic facts. Do not pay
      // for an LLM paraphrase that could obscure the actual failure.
      if (resultForLoop.status !== 'ok') {
        return hostFacingMessage(resultForLoop, '요청을 처리하지 못했습니다.');
      }
      const deterministicReply = deterministicHttpChatReply(
        jevRoute.command,
        resultForLoop,
        options.userMessage,
      ) ?? deterministicCapabilityReadChatReply(
        jevRoute.command,
        resultForLoop,
        options.userMessage,
      );
      if (deterministicReply) {
        appendAppLog('info', 'Jev-selected read used a deterministic chat renderer.', {
          event: 'jev_chat_deterministic_reply',
          route: jevRoute.route,
          command: jevRoute.command.name,
        });
        return deterministicReply;
      }
      messages.push(
        { role: 'assistant', content: JSON.stringify({ kind: 'command', command: jevRoute.command }) },
        { role: 'user', content: resultMessage(resultForLoop) },
      );
      const reply = await textReplyFromModel('ax_command_chat_jev_result');
      if (reply) return reply;
    }
  }

  for (let round = 0; round < maxRounds; round += 1) {
    if (signal.aborted) throw new Error('ax_command_chat_timeout');
    let output: unknown;
    try {
      const lifecycleConstraint = delegatedCommandNames
        ? `\nJev selected the ${delegatedCommandNames[0]} lifecycle for this request. You may emit only one command from this allowlist while gathering evidence or filling its payload: ${delegatedCommandNames.join(', ')}. Do not switch to another mutation lifecycle.`
        : '';
      const result = await options.harness.run({
        role: 'command',
        outputSchema: transport.outputSchema,
        systemPrompt: commandProtocolPrompt({
          ...options,
          currentWorkflowId: session.workflowId,
          sessionMemo: session.sessionMemo,
          workflowPolicy: session.workflowPolicy,
        }, `${transport.outputInstructions}${lifecycleConstraint}`, delegatedCommandNames),
        context: commandContext(options),
        messages: compactModelMessages(messages, options.userMessage),
        sessionId: options.providerSessionId,
        onProgress: options.onProgress,
        logContext: round === 0 ? 'ax_command_chat' : `ax_command_chat_${round}`,
        codexReasoningEffort: 'medium',
        abortSignal: signal,
      });
      output = result.output;
    } catch (error) {
      signal.throwIfAborted();
      const message = protocolFailureMessage(error);
      if (message) {
        if (retryProtocolResponse()) continue;
        return message;
      }
      throw error;
    }

    signal.throwIfAborted();
    let parsed: ReturnType<typeof transport.normalize>;
    try {
      parsed = transport.normalize(output);
    } catch (error) {
      const message = protocolFailureMessage(error);
      if (message) {
        if (retryProtocolResponse()) continue;
        return message;
      }
      throw error;
    }
    if (parsed.kind === 'reply') return parsed.message;
    protocolRecoveryAttempts = 0;

    if (delegatedCommandNames && !delegatedCommandNames.includes(parsed.command.name)) {
      const message = '요청한 작업의 수명주기와 다른 명령이 제안되어 실행하지 않았습니다. 원하는 작업 유형을 다시 확인해 주세요.';
      appendAppLog('warn', 'LLM command did not match the Jev-selected lifecycle.', {
        event: 'jev_chat_route_command_mismatch',
        command: parsed.command.name,
        expected: delegatedCommandNames[0],
      });
      const blocked = commandResult(
        parsed.command.name,
        'needs_input',
        undefined,
        [commandIssue('semantic_route_mismatch', message)],
      );
      return hostFacingMessage(publishResult(parsed.command.name, blocked), message);
    }

    const blockedMessage = await semanticGateMessage(parsed.command);
    if (blockedMessage) return blockedMessage;

    const result = await options.commandService.execute(parsed.command, {
      designToolContext: options.designToolContext,
      designToolContextFactory: options.designToolContextFactory,
      executionContext: AGENT_COMMAND_CONTEXT,
      userMessage: options.userMessage,
      workspaceSessionId: options.workspaceSessionId,
      currentWorkflowId: session.workflowId,
      allowContextUpdate: options.allowContextUpdate,
      abortSignal: signal,
    });
    signal.throwIfAborted();
    const resultForLoop = publishResult(parsed.command.name, result);
    if (parsed.command.name === 'job.propose') {
      return hostFacingMessage(resultForLoop, '업무 초안을 처리하지 못했습니다.');
    }
    if (parsed.command.name === 'execution.enqueue_once' && resultForLoop.status === 'needs_input') {
      return hostFacingMessage(resultForLoop, '일회 실행에 필요한 정보를 확인해 주세요.');
    }
    messages.push(
      { role: 'assistant', content: JSON.stringify({ kind: 'command', command: parsed.command }) },
      { role: 'user', content: resultMessage(resultForLoop) },
    );
  }

  return undefined;
}
