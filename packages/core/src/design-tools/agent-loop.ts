import type { ChatMessage } from '../agent/model/chat.js';
import {
  executeDesignToolCalls,
  formatDesignToolResults,
  type DesignToolCall,
  type DesignToolContext,
} from './index.js';
import { filterToolCallsForMode } from '../platform/mode-policy.js';
import { bootstrapDesignToolMessages, hasDesignToolResults } from './bootstrap.js';

export interface StructuredToolLoopOptions<TOutput> {
  maxRounds: number;
  messages: ChatMessage[];
  userMessage: string;
  designToolContext: DesignToolContext;
  bootstrap?: boolean;
  onProgress?: (event: { message: string }) => void;
  runModel: (messages: ChatMessage[]) => Promise<TOutput>;
  parseOutput: (output: TOutput) => { kind: 'tools'; toolCalls: DesignToolCall[] } | { kind: 'reply'; message: string };
  exhaustedMessage: string;
}

/** Shared AX-side design-tool loop used by workspace chat and CLI providers. */
export async function runStructuredDesignToolLoop<TOutput>(
  options: StructuredToolLoopOptions<TOutput>,
): Promise<string> {
  const userTurn: ChatMessage = { role: 'user', content: options.userMessage.trim() };
  const loopMessages: ChatMessage[] = [...options.messages];

  const shouldBootstrap = options.bootstrap ?? true;
  if (shouldBootstrap && !hasDesignToolResults(loopMessages)) {
    loopMessages.push(...(await bootstrapDesignToolMessages(options.designToolContext)));
  }

  for (let round = 0; round < options.maxRounds; round += 1) {
    options.onProgress?.({
      message: round === 0 ? '연결된 리소스를 확인하고 있습니다…' : '답변을 정리하고 있습니다…',
    });

    const output = await options.runModel([...loopMessages, userTurn]);
    const parsed = options.parseOutput(output);

    if (parsed.kind === 'reply') {
      return parsed.message.trim();
    }

    const mode = options.designToolContext.interactionMode
      ?? (options.designToolContext.workflow ? 'authoring' : 'plain_chat');
    const toolCalls = filterToolCallsForMode(parsed.toolCalls, mode);
    if (toolCalls.length === 0) {
      loopMessages.push({
        role: 'assistant',
        content: `[design-tools]\n${JSON.stringify(parsed.toolCalls, null, 2)}`,
      });
      loopMessages.push({
        role: 'user',
        content: '[design-tool results]\n[{"ok":false,"error":"tool_not_allowed_in_mode"}]',
      });
      continue;
    }

    options.onProgress?.({ message: '리소스를 조회하고 있습니다…' });
    const results = await executeDesignToolCalls(toolCalls, options.designToolContext);
    loopMessages.push(
      { role: 'assistant', content: `[design-tools]\n${JSON.stringify(toolCalls, null, 2)}` },
      { role: 'user', content: `[design-tool results]\n${formatDesignToolResults(results)}` },
    );
  }

  return options.exhaustedMessage;
}
