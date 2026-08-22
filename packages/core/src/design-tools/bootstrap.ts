import type { ChatMessage } from '../agent/model/chat.js';
import { executeDesignToolCalls, formatDesignToolResults } from './execute.js';
import type { DesignToolCall, DesignToolContext } from './types.js';

const WORKSPACE_BOOTSTRAP_TOOLS: DesignToolCall[] = [
  { tool: 'tools.list', args: {} },
  { tool: 'connections.list', args: {} },
  { tool: 'sources.list', args: {} },
  { tool: 'capabilities.list', args: {} },
];

export function hasDesignToolResults(messages: ChatMessage[]): boolean {
  return messages.some((message) => message.role === 'assistant' && message.content.startsWith('[design-tools]'));
}

/** Pre-load read-only workspace context for providers without native tool use. */
export async function bootstrapDesignToolMessages(
  designToolContext: DesignToolContext,
): Promise<ChatMessage[]> {
  const results = await executeDesignToolCalls(WORKSPACE_BOOTSTRAP_TOOLS, designToolContext);
  return [
    {
      role: 'assistant',
      content: `[design-tools]\n${JSON.stringify(WORKSPACE_BOOTSTRAP_TOOLS, null, 2)}`,
    },
    {
      role: 'user',
      content: `[design-tool results]\n${formatDesignToolResults(results)}`,
    },
  ];
}
