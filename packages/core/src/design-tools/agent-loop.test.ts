import { describe, expect, it, vi } from 'vitest';
import { runStructuredDesignToolLoop } from './agent-loop.js';
import { buildDesignToolContext } from './context.js';
import type { ChatMessage } from '../agent/model/chat.js';

describe('runStructuredDesignToolLoop', () => {
  it('returns reply on first model turn', async () => {
    const calls: ChatMessage[][] = [];
    const reply = await runStructuredDesignToolLoop({
      maxRounds: 3,
      messages: [],
      userMessage: 'hello',
      designToolContext: buildDesignToolContext([], []),
      bootstrap: false,
      runModel: async (messages) => {
        calls.push(messages);
        return { kind: 'reply', message: '안녕하세요' };
      },
      parseOutput: (output) => output as { kind: 'reply'; message: string },
      exhaustedMessage: 'exhausted',
    });
    expect(reply).toBe('안녕하세요');
    expect(calls).toHaveLength(1);
    expect(calls[0]?.at(-1)).toEqual({ role: 'user', content: 'hello' });
  });

  it('executes tools then returns final reply', async () => {
    let round = 0;
    const reply = await runStructuredDesignToolLoop({
      maxRounds: 3,
      messages: [],
      userMessage: 'what connectors?',
      designToolContext: buildDesignToolContext([], []),
      bootstrap: false,
      runModel: async () => {
        round += 1;
        if (round === 1) {
          return {
            kind: 'tools',
            toolCalls: [{ tool: 'connections.list', args: {} }],
          };
        }
        return { kind: 'reply', message: 'none connected' };
      },
      parseOutput: (output) =>
        output as
          | { kind: 'tools'; toolCalls: Array<{ tool: 'connections.list'; args?: Record<string, unknown> }> }
          | { kind: 'reply'; message: string },
      exhaustedMessage: 'exhausted',
    });
    expect(reply).toBe('none connected');
    expect(round).toBe(2);
  });
});
