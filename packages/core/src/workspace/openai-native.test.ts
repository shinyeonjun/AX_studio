import { describe, expect, it, vi, afterEach, beforeEach } from 'vitest';
import { runOpenAiNativeWorkspaceChat } from './openai-native.js';
import { buildDesignToolContext } from '../design-tools/context.js';

describe('runOpenAiNativeWorkspaceChat', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('runs function-calling loop then returns assistant text', async () => {
    let call = 0;
    globalThis.fetch = vi.fn(async () => {
      call += 1;
      if (call === 1) {
        return new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: null,
                  tool_calls: [
                    {
                      id: 'call_1',
                      type: 'function',
                      function: { name: 'connections_list', arguments: '{}' },
                    },
                  ],
                },
              },
            ],
          }),
          { status: 200 },
        );
      }
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: '연결된 계정이 없습니다.' } }],
        }),
        { status: 200 },
      );
    }) as typeof fetch;

    const reply = await runOpenAiNativeWorkspaceChat({
      baseURL: 'https://api.openai.com/v1',
      apiKey: 'test-key',
      model: 'gpt-4o-mini',
      system: 'workspace',
      messages: [],
      userMessage: '뭐가 연결돼 있어?',
      designToolContext: buildDesignToolContext([], []),
    });

    expect(reply).toBe('연결된 계정이 없습니다.');
    expect(call).toBe(2);
  });

  it('rejects an unbounded provider tool batch', async () => {
    globalThis.fetch = vi.fn(async () => new Response(
      JSON.stringify({
        choices: [{
          message: {
            content: null,
            tool_calls: Array.from({ length: 6 }, (_, index) => ({
              id: `call_${index}`,
              type: 'function',
              function: { name: 'connections_list', arguments: '{}' },
            })),
          },
        }],
      }),
      { status: 200 },
    )) as typeof fetch;

    await expect(runOpenAiNativeWorkspaceChat({
      baseURL: 'https://api.openai.com/v1',
      apiKey: 'test-key',
      model: 'gpt-4o-mini',
      system: 'workspace',
      messages: [],
      userMessage: '연결 상태를 확인해줘',
      designToolContext: buildDesignToolContext([], []),
    })).rejects.toThrow('too_many_design_tool_calls:5');
  });
});
