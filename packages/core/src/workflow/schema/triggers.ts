import { z } from 'zod';
import { ConditionExprSchema } from '../../runtime/condition-expr.js';

export const TriggerFilterSchema = ConditionExprSchema;

export const TriggerSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('manual'),
    filter: TriggerFilterSchema.optional(),
  }),
  z.object({
    type: z.literal('schedule'),
    schedule: z.string(),
    timezone: z.string(),
    filter: TriggerFilterSchema.optional(),
  }),
  z.object({
    type: z.literal('gmail.new_message'),
    accountId: z.string(),
    filter: TriggerFilterSchema.optional(),
  }),
  z.object({
    type: z.literal('slack.new_message'),
    channel: z.string(),
    filter: TriggerFilterSchema.optional(),
  }),
  z.object({
    type: z.literal('local_folder.new_file'),
    folderId: z.string(),
    folderPath: z.string().optional(),
    extensions: z.array(z.string()).optional(),
    filter: TriggerFilterSchema.optional(),
  }),
  z.object({
    type: z.literal('once'),
    runAt: z.string(),
    filter: TriggerFilterSchema.optional(),
  }),
  z.object({
    type: z.literal('webhook.inbound'),
    path: z.string(),
    filter: TriggerFilterSchema.optional(),
  }),
]);

export type Trigger = z.infer<typeof TriggerSchema>;
