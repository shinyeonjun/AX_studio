import { describe, expect, it } from 'vitest';
import { createAxCommandChatTransport } from './transport.js';
import { AX_COMMAND_CHAT_PROTOCOL_ERROR_MESSAGE } from './transport-contract.js';

describe('AX command provider transports', () => {
  it('normalizes Codex flat wire output into the canonical command', () => {
    const transport = createAxCommandChatTransport('codex-cli');
    const wire = transport.outputSchema.parse({
      kind: 'command',
      commandName: 'capability.list',
      argsJson: '{"connector":"slack","kind":"write"}',
      message: '',
    });

    expect(transport.normalize(wire)).toEqual({
      kind: 'command',
      command: {
        name: 'capability.list',
        args: { connector: 'slack', kind: 'write' },
      },
    });
  });

  it('normalizes Codex commands when argsJson contains literal message line breaks', () => {
    const transport = createAxCommandChatTransport('codex-cli');
    const wire = transport.outputSchema.parse({
      kind: 'command',
      commandName: 'capability.invoke',
      argsJson: `{
        "id": "test.capability",
        "params": {
          "text": "
[CRITICAL] 고객-티켓 불일치: Naver
"
        }
      }`,
      message: '',
    });

    expect(transport.normalize(wire)).toEqual({
      kind: 'command',
      command: {
        name: 'capability.invoke',
        args: {
          id: 'test.capability',
          params: { text: '\n[CRITICAL] 고객-티켓 불일치: Naver\n' },
        },
      },
    });
  });

  it('normalizes Claude nested wire output without passing CLI details to chat', () => {
    const transport = createAxCommandChatTransport('claude-cli');
    const wire = transport.outputSchema.parse({
      kind: 'command',
      command: { name: 'capability.list', args: {} },
      message: '',
    });

    expect(transport.normalize(wire)).toEqual({
      kind: 'command',
      command: { name: 'capability.list', args: {} },
    });
  });

  it('keeps API and local providers on the canonical object contract', () => {
    const transport = createAxCommandChatTransport('ollama-api');
    expect(transport.normalize({
      kind: 'reply',
      message: '확인했습니다.',
    })).toEqual({ kind: 'reply', message: '확인했습니다.' });
  });

  it.each([
    ['codex-cli', { kind: 'command', commandName: 'rdb.schema.describe', argsJson: '{}', message: '' }],
    ['claude-cli', { kind: 'command', command: { name: 'rdb.schema.describe', args: {} }, message: '' }],
    ['ollama-api', { kind: 'command', command: { name: 'rdb.schema.describe', args: {} }, message: '' }],
  ])('rejects an internal capability id as an outer command for %s', (provider, value) => {
    const transport = createAxCommandChatTransport(provider);
    const wire = transport.outputSchema.parse(value);

    expect(() => transport.normalize(wire)).toThrow(AX_COMMAND_CHAT_PROTOCOL_ERROR_MESSAGE);
  });

  it('rejects malformed Codex args without exposing parser details', () => {
    const transport = createAxCommandChatTransport('codex-cli');
    const wire = transport.outputSchema.parse({
      kind: 'command',
      commandName: 'capability.invoke',
      argsJson: '{"id":',
      message: '',
    });

    expect(() => transport.normalize(wire)).toThrow(AX_COMMAND_CHAT_PROTOCOL_ERROR_MESSAGE);
  });
});
