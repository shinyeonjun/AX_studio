import { z } from 'zod';
import {
  AxCommandChatProtocolError,
  AxCommandWireSchema,
  normalizeAxCommand,
} from '../transport-contract.js';
import type { AxCommandChatTransport } from '../transport-contract.js';

const DirectCommandWireSchema = z.object({
  kind: z.enum(['command', 'reply']),
  command: AxCommandWireSchema.optional(),
  message: z.string().default(''),
});

/** API and local providers return the canonical envelope; the host validates the command name. */
export const directCommandTransport: AxCommandChatTransport = {
  outputSchema: DirectCommandWireSchema,
  outputInstructions:
    'AX 내부 형식: command는 {name,args} 객체로, reply는 message 문자열로 반환한다.',
  normalize(value) {
    const wire = DirectCommandWireSchema.parse(value);
    if (wire.kind === 'reply') {
      const message = wire.message.trim();
      if (!message) throw new AxCommandChatProtocolError();
      return { kind: 'reply', message };
    }
    if (!wire.command) throw new AxCommandChatProtocolError();
    return { kind: 'command', command: normalizeAxCommand(wire.command) };
  },
};
