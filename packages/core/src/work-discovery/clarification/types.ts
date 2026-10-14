import { z } from 'zod';

const ClarificationOptionSchema = z.object({
  id: z.string(),
  label: z.string(),
  candidateIds: z.array(z.string()).min(1),
  value: z.string().optional(),
});

export const ClarificationQuestionSchema = z.object({
  id: z.string(),
  sessionId: z.string(),
  kind: z.enum([
    'choose_rule',
    'confirm_rule',
    'identify_source',
    'identify_period',
    'free_text_business_rule',
  ]),
  prompt: z.string(),
  context: z.string().optional(),
  options: z.array(ClarificationOptionSchema).min(2),
  affectedObservationPaths: z.array(z.string()).default([]),
  createdAt: z.string(),
});

export type ClarificationQuestion = z.infer<typeof ClarificationQuestionSchema>;
