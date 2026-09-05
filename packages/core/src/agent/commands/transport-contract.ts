import { z } from 'zod';
import type { ZodTypeAny } from 'zod';
import { AxCommandSchema, type AxCommand } from './schema.js';

export const AX_COMMAND_CHAT_PROTOCOL_ERROR_MESSAGE =
  'AI가 지원되지 않는 명령 형식을 반환해 실행하지 않았습니다. 요청을 다시 보내 주세요.';

/** Host-only correction sent back to the model after a rejected wire response. */
export const AX_COMMAND_CHAT_PROTOCOL_RETRY_MESSAGE =
  '이전 응답은 AX command 계약 밖이어서 host가 폐기했습니다. 명령은 실행되지 않았습니다. 현재 system prompt에 주입된 AX command의 name 하나만 바깥 command로 반환하거나 자연어 reply를 반환하세요. capability ID는 capability.invoke의 args.id 안에서만 사용하고 command.name 또는 commandName으로 반환하지 마세요. 내부 오류 JSON과 계약 밖 이름은 다시 출력하지 마세요.';

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
