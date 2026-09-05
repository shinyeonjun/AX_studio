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
  if (options.allowJobCommit) {
    const result = await options.commandService.execute({ name: 'job.commit', args: {} }, {
      executionContext: AGENT_COMMAND_CONTEXT,
      workspaceSessionId: options.workspaceSessionId,
      allowJobCommit: true,
    });
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
      const message = protocolFailureMessage(error);
      if (message) {
        if (retryProtocolResponse()) continue;
        return message;
      }
      throw error;
    }

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

    const result = await options.commandService.execute(parsed.command, {
      designToolContext: options.designToolContext,
      designToolContextFactory: options.designToolContextFactory,
      executionContext: AGENT_COMMAND_CONTEXT,
      workspaceSessionId: options.workspaceSessionId,
      currentWorkflowId: session.workflowId,
      allowContextUpdate: options.allowContextUpdate,
    });
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
