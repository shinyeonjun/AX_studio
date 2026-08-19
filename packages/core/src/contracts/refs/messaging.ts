import { z } from 'zod';

export const EmailMessageRefSchema = z.object({
  id: z.string(),
  accountId: z.string().optional(),
});

export type EmailMessageRef = z.infer<typeof EmailMessageRefSchema>;

export const SlackChannelRefSchema = z.object({
  channelId: z.string(),
  label: z.string().optional(),
});

export type SlackChannelRef = z.infer<typeof SlackChannelRefSchema>;

export const SlackMessageRefSchema = z.object({
  channelId: z.string(),
  messageId: z.string(),
  ts: z.string().optional(),
});

export type SlackMessageRef = z.infer<typeof SlackMessageRefSchema>;
