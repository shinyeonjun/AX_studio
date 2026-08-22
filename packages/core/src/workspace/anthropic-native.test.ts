import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { anthropicDesignToolDefinitions, runAnthropicNativeWorkspaceChat } from './anthropic-native.js';
import { buildDesignToolContext } from '../design-tools/context.js';

describe('runAnthropicNativeWorkspaceChat', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    process.env.ANTHROPIC_API_KEY = 'test-key';
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('maps design tools to Anthropic tool definitions', () => {
    const tools = anthropicDesignToolDefinitions();
    expect(tools.some((tool) => tool.name === 'connections_list')).toBe(true);
    expect(tools.some((tool) => tool.name === 'capabilities_describe')).toBe(true);
  });

  it('runs tool_use loop then returns assistant text', async () => {
    let call = 0;
    globalThis.fetch = vi.fn(async () => {
      call += 1;
      if (call === 1) {
        return new Response(
          JSON.stringify({
            stop_reason: 'tool_use',
            content: [
              { type: 'tool_use', id: 'tu_1', name: 'connections_list', input: {} },
            ],
          }),
          { status: 200 },
        );
      }
      return new Response(
        JSON.stringify({
          stop_reason: 'end_turn',
          content: [{ type: 'text', text: '연결된 계정이 없습니다.' }],
        }),
        { status: 200 },
      );
    }) as typeof fetch;

    const reply = await runAnthropicNativeWorkspaceChat({
      model: 'claude-sonnet-4-20250514',
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
        stop_reason: 'tool_use',
        content: Array.from({ length: 6 }, (_, index) => ({
          type: 'tool_use',
          id: `tu_${index}`,
          name: 'connections_list',
          input: {},
        })),
      }),
      { status: 200 },
    )) as typeof fetch;

    await expect(runAnthropicNativeWorkspaceChat({
      model: 'claude-sonnet-4-20250514',
      system: 'workspace',
      messages: [],
      userMessage: '연결 상태를 확인해줘',
      designToolContext: buildDesignToolContext([], []),
    })).rejects.toThrow('too_many_design_tool_calls:5');
  });
});
