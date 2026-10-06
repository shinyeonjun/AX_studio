import { z } from 'zod';
import { ConditionExprSchema } from '../condition-expr/schema.js';
import { RecurrenceSchema } from '../schedule/recurrence.js';

export const TriggerFilterSchema = ConditionExprSchema;

export const TriggerSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('manual'),
    filter: TriggerFilterSchema.optional(),
  }),
  z.object({
    type: z.literal('schedule'),
    /** Legacy 5-field cron, kept so saved workflows keep running unchanged. */
    schedule: z.string().optional(),
    /** Typed recurrence; new schedules use this instead of cron. */
    recurrence: RecurrenceSchema.optional(),
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
]).superRefine((trigger, context) => {
  if (trigger.type !== 'schedule') return;
  if ((trigger.schedule === undefined) === (trigger.recurrence === undefined)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['schedule'],
      message: 'A schedule trigger needs exactly one of schedule (cron) or recurrence.',
    });
  }
  if (trigger.recurrence && trigger.recurrence.timezone !== trigger.timezone) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['timezone'],
      message: 'The trigger timezone must match the recurrence timezone.',
    });
  }
});

export type Trigger = z.infer<typeof TriggerSchema>;
