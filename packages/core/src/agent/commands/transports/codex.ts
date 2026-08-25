import { z } from 'zod';
import { parseJsonObject } from '../../model/cli-json.js';
import { AxCommandSchema } from '../schema.js';
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
  if (!trimmed) throw new Error('ax_command_chat_empty_reply');
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
    if (!name) throw new Error('ax_command_chat_command_name_missing');
    const args = wire.argsJson.trim() ? parseJsonObject(wire.argsJson) : {};
    return { kind: 'command', command: AxCommandSchema.parse({ name, args }) };
  },
};
