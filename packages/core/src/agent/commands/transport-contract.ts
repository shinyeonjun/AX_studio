import { z } from 'zod';
import type { ZodTypeAny } from 'zod';
import { AxCommandSchema } from './schema.js';

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
