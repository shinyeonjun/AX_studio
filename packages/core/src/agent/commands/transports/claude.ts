import { z } from 'zod';
import { AxCommandSchema } from '../schema.js';
import type { AxCommandChatOutput, AxCommandChatTransport } from '../transport-contract.js';

/** Claude CLI can return the nested command object directly through json-schema. */
const ClaudeCommandWireSchema = z.object({
  kind: z.enum(['command', 'reply']),
  command: AxCommandSchema.optional(),
  message: z.string().default(''),
});

function replyFrom(message: string): AxCommandChatOutput {
  const trimmed = message.trim();
  if (!trimmed) throw new Error('ax_command_chat_empty_reply');
  return { kind: 'reply', message: trimmed };
}

export const claudeCommandTransport: AxCommandChatTransport = {
  outputSchema: ClaudeCommandWireSchema,
  outputInstructions:
    'Claude 형식: command는 {name,args} 객체로 반환하고, reply는 message에 넣는다. 예: {"kind":"command","command":{"name":"capability.list","args":{}},"message":""}',
  normalize(value) {
    const wire = ClaudeCommandWireSchema.parse(value);
    if (wire.kind === 'reply') return replyFrom(wire.message);
    if (!wire.command) throw new Error('ax_command_chat_command_missing');
    return { kind: 'command', command: wire.command };
  },
};
