import { z } from 'zod';
import {
  AxCommandIssueSchema,
  AxInputRequestSchema,
} from './interaction.js';

export const AxCommandStatusSchema = z.enum([
  'ok',
  'needs_input',
  'not_found',
  'conflict',
  'invalid',
  'forbidden',
  'queued',
  'error',
]);

export type AxCommandStatus = z.infer<typeof AxCommandStatusSchema>;

export const AxCommandResultSchema = z.object({
  command: z.string(),
  status: AxCommandStatusSchema,
  data: z.unknown().optional(),
  issues: z.array(AxCommandIssueSchema).default([]),
  inputRequests: z.array(AxInputRequestSchema).default([]),
});

export type AxCommandResult = z.infer<typeof AxCommandResultSchema>;
