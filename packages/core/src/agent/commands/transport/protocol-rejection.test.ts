import { describe, expect, it } from 'vitest';
import { createAxCommandChatTransport } from '../transport.js';
import { AX_COMMAND_CHAT_PROTOCOL_ERROR_MESSAGE } from '../transport-contract.js';

describe('AX command provider transport protocol rejection', () => {
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
      kind: 'command', commandName: 'capability.invoke', argsJson: '{"id":', message: '',
    });

    expect(() => transport.normalize(wire)).toThrow(AX_COMMAND_CHAT_PROTOCOL_ERROR_MESSAGE);
  });
});
