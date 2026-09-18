import type { ChatMessage } from '../../model/chat.js';
import type { AxCommandChatOptions } from './contracts.js';
import type { AxCommandResult } from '../schema.js';
import type { AxCommandChatTransport } from '../transport-contract.js';
import { AGENT_COMMAND_CONTEXT } from '../access.js';
import {
  commandContext,
  commandProtocolPrompt,
  protocolFailureMessage,
  protocolRecoveryMessage,
  resultMessage,
} from './protocol.js';
import { hostFacingMessage, type CommandChatSessionState } from './result.js';
import { routeChatWithJev } from './jev-router.js';
import { appendAppLog } from '../../../../persistence/paths/app-log.js';
import { gateChatCommandWithJev } from './jev-command-gate.js';
import { issue as commandIssue, result as commandResult } from '../contract.js';

const MAX_PROTOCOL_RECOVERY_ATTEMPTS = 1;

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

  if (options.decisionEngine && !options.allowContextUpdate) {
    const jevRoute = await routeChatWithJev({
      decisionEngine: options.decisionEngine,
      userMessage: options.userMessage,
      currentWorkflowId: session.workflowId,
      hasWorkspaceSession: Boolean(options.workspaceSessionId),
      connectedConnectors: options.connectedConnectors,
      abortSignal: signal,
    });
    if (jevRoute.kind === 'fallback') {
      appendAppLog('info', 'Jev chat route fell back to the LLM command path.', {
        event: 'jev_chat_route_fallback',
        reason: jevRoute.reason,
      });
    }
    if (jevRoute.kind === 'command') {
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
      if (jevRoute.command.name === 'workflow.run') {
        return hostFacingMessage(resultForLoop, '워크플로우 실행 요청을 처리하지 못했습니다.');
      }
      messages.push(
        { role: 'assistant', content: JSON.stringify({ kind: 'command', command: jevRoute.command }) },
        { role: 'user', content: resultMessage(resultForLoop) },
      );
    }
  }

  for (let round = 0; round < maxRounds; round += 1) {
    if (signal.aborted) throw new Error('ax_command_chat_timeout');
    let output: unknown;
    try {
      const result = await options.harness.run({
        role: 'command',
        outputSchema: transport.outputSchema,
        systemPrompt: commandProtocolPrompt({
          ...options,
          currentWorkflowId: session.workflowId,
          sessionMemo: session.sessionMemo,
          workflowPolicy: session.workflowPolicy,
        }, transport.outputInstructions),
        context: commandContext(options),
        messages,
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

    const definition = options.commandService
      .listCommands(AGENT_COMMAND_CONTEXT)
      .find((entry) => entry.name === parsed.command.name);
    if (options.decisionEngine && definition?.mutates && !options.allowContextUpdate) {
      const gate = await gateChatCommandWithJev({
        decisionEngine: options.decisionEngine,
        userMessage: options.userMessage,
        command: parsed.command,
        definition,
        currentWorkflowId: session.workflowId,
        abortSignal: signal,
      });
      if (!gate.allowed) {
        appendAppLog('warn', 'Jev mutation intent gate blocked a command.', {
          event: 'jev_command_gate_blocked',
          command: parsed.command.name,
          reason: gate.reason,
        });
        const message = gate.reason === 'service_unavailable'
          ? '의미 판단 서비스를 확인할 수 없어 변경 작업을 실행하지 않았습니다. 잠시 후 다시 시도해 주세요.'
          : '사용자 요청과 실행 작업의 의미가 명확히 일치하지 않아 실행하지 않았습니다. 대상과 원하는 작업을 구체적으로 알려 주세요.';
        const blocked = commandResult(
          parsed.command.name,
          'needs_input',
          undefined,
          [commandIssue(
            'semantic_confirmation_required',
            message,
          )],
        );
        return hostFacingMessage(publishResult(parsed.command.name, blocked), message);
      }
    }

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
