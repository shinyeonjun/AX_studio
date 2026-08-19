import { z } from 'zod';

export const DraftIRSchema = z.object({
  name: z.string(),
  goal: z.string(),
  triggerType: z.enum(['manual', 'schedule', 'gmail.new_message']).optional(),
  schedule: z.string().optional(),
  timezone: z.string().optional(),
  gmailAccount: z.string().optional(),
  slackChannel: z.string().optional(),
  localFilePath: z.string().optional(),
  rdbConnectionId: z.string().optional(),
  reportTemplate: z.string().optional(),
  needsApproval: z.boolean().optional(),
  success: z.string().optional(),
  assumptions: z.array(z.string()).default([]),
  includeSlack: z.boolean().default(false),
  includeGmailSend: z.boolean().default(false),
  includeInvestigation: z.boolean().default(false),
});
