import { z } from 'zod';
import {
  AxCommandChatProtocolError,
  AxCommandWireSchema,
  normalizeAxCommand,
} from '../transport-contract.js';
import type { AxCommandChatOutput, AxCommandChatTransport } from '../transport-contract.js';

/** Claude CLI can return the nested command object directly through json-schema. */
const ClaudeCommandWireSchema = z.object({
  kind: z.enum(['command', 'reply']),
  command: AxCommandWireSchema.optional(),
  message: z.string().default(''),
});

function replyFrom(message: string): AxCommandChatOutput {
  const trimmed = message.trim();
  if (!trimmed) throw new AxCommandChatProtocolError();
  return { kind: 'reply', message: trimmed };
}

export const claudeCommandTransport: AxCommandChatTransport = {
  outputSchema: ClaudeCommandWireSchema,
  outputInstructions:
    'Claude 형식: command는 {name,args} 객체로 반환하고, reply는 message에 넣는다. 예: {"kind":"command","command":{"name":"capability.list","args":{}},"message":""}',
  normalize(value) {
    const wire = ClaudeCommandWireSchema.parse(value);
    if (wire.kind === 'reply') return replyFrom(wire.message);
    if (!wire.command) throw new AxCommandChatProtocolError();
    return { kind: 'command', command: normalizeAxCommand(wire.command) };
  },
};
