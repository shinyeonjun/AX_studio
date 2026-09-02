import { z } from 'zod';
import { parseJsonObject } from '../../model/cli-json.js';
import {
  AxCommandChatProtocolError,
  normalizeAxCommand,
} from '../transport-contract.js';
import type { AxCommandChatOutput, AxCommandChatTransport } from '../transport-contract.js';

/** Codex CLI is given a flat object because its output-schema path is strict. */
const CodexCommandWireSchema = z.object({
  kind: z.enum(['command', 'reply']),
  commandName: z.string().default(''),
  argsJson: z.string().default(''),
  message: z.string().default(''),
});

function replyFrom(message: string): AxCommandChatOutput {
  const trimmed = message.trim();
  if (!trimmed) throw new AxCommandChatProtocolError();
  return { kind: 'reply', message: trimmed };
}

export const codexCommandTransport: AxCommandChatTransport = {
  outputSchema: CodexCommandWireSchema,
  outputInstructions:
    'Codex 형식: command는 commandName 문자열과 argsJson JSON 문자열로 반환하고, reply는 message에 넣는다. argsJson 안의 문자열 줄바꿈은 반드시 \\n으로 escape한다. 예: {"kind":"command","commandName":"capability.list","argsJson":"{}","message":""}',
  normalize(value) {
    const wire = CodexCommandWireSchema.parse(value);
    if (wire.kind === 'reply') return replyFrom(wire.message);
    const name = wire.commandName.trim();
    if (!name) throw new AxCommandChatProtocolError();
    let args: unknown = {};
    if (wire.argsJson.trim()) {
      try {
        args = parseJsonObject(wire.argsJson);
      } catch {
        throw new AxCommandChatProtocolError();
      }
    }
    return { kind: 'command', command: normalizeAxCommand({ name, args }) };
  },
};
