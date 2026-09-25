import { z } from 'zod';
import type { ZodTypeAny } from 'zod';
import { AxCommandSchema, type AxCommand } from './schema.js';

export const AX_COMMAND_CHAT_PROTOCOL_ERROR_MESSAGE =
  'AI가 지원되지 않는 명령 형식을 반환해 실행하지 않았습니다. 요청을 다시 보내 주세요.';

/** A provider returned a structurally readable response outside the AX command contract. */
export class AxCommandChatProtocolError extends Error {
  readonly code = 'ax_command_chat_protocol_invalid';

  constructor() {
    super(AX_COMMAND_CHAT_PROTOCOL_ERROR_MESSAGE);
    this.name = 'AxCommandChatProtocolError';
  }
}

/** Validate a provider command only after its provider-specific wire envelope is decoded. */
export function normalizeAxCommand(value: unknown): AxCommand {
  const parsed = AxCommandSchema.safeParse(value);
  if (!parsed.success) throw new AxCommandChatProtocolError();
  return parsed.data;
}

/** Provider wire schemas keep the command name open; the host enforces AX_COMMAND_NAMES. */
export const AxCommandWireSchema = z.object({
  name: z.string(),
  args: z.record(z.unknown()).default({}),
});

/** Canonical command result used inside AX, independent of the model provider. */
export const AxCommandChatOutputSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('command'),
    command: AxCommandSchema,
  }),
  z.object({
    kind: z.literal('reply'),
    message: z.string().min(1),
  }),
]);

export type AxCommandChatOutput = z.infer<typeof AxCommandChatOutputSchema>;

export interface AxCommandChatTransport {
  readonly outputSchema: ZodTypeAny;
  readonly outputInstructions: string;
  normalize(value: unknown): AxCommandChatOutput;
}
