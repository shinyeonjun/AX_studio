import { z } from 'zod';
import type { WorkflowIR } from '../../../workflow/schema.js';

export const JOB_COMMIT_CONFIRM_VALUE = '이 업무를 저장하고 스케줄을 켜줘';
export const DEFAULT_JOB_CRON = '0 21 * * *';
export const DEFAULT_JOB_TIMEZONE = 'Asia/Seoul';

/** Models often emit compact strings instead of the nested objects in the command contract. */
export function coerceJobProposeArgs(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const record = { ...(value as Record<string, unknown>) };
  const asFilledString = (input: unknown): string | undefined =>
    typeof input === 'string' && input.trim() ? input : undefined;
  const asBoolean = (input: unknown): unknown =>
    input === 'true' ? true : input === 'false' ? false : input;

  if (typeof record.interpret === 'string') record.interpret = { goal: record.interpret };
  if (typeof record.notify === 'string') record.notify = { channel: record.notify };
  if (typeof record.fetch === 'string') record.fetch = { path: record.fetch };
  if (typeof record.schedule === 'string') {
    const fields = record.schedule.trim().split(/\s+/);
    record.schedule = fields.length >= 6
      ? { cron: fields.slice(0, 5).join(' '), timezone: fields.slice(5).join(' ') }
      : { cron: record.schedule };
  }

  // Lift the top-level aliases models emit when they answer a needs_input turn.
  const topPath = asFilledString(record.httpPath) ?? asFilledString(record.path);
  const topConnection = asFilledString(record.connectionId) ?? asFilledString(record.connection_id);
  if (topPath || topConnection) {
    const fetch = record.fetch && typeof record.fetch === 'object' && !Array.isArray(record.fetch)
      ? { ...(record.fetch as Record<string, unknown>) }
      : {};
    if (topPath && fetch.path == null) fetch.path = topPath;
    if (topConnection && fetch.connectionId == null) fetch.connectionId = topConnection;
    record.fetch = fetch;
  }
  const topChannel = asFilledString(record.channel);
  if (topChannel) {
    const notify = record.notify && typeof record.notify === 'object' && !Array.isArray(record.notify)
      ? { ...(record.notify as Record<string, unknown>) }
      : {};
    if (notify.channel == null) notify.channel = topChannel;
    record.notify = notify;
  }

  if (record.fetch && typeof record.fetch === 'object' && !Array.isArray(record.fetch)) {
    const fetch = { ...(record.fetch as Record<string, unknown>) };
    if (typeof fetch.method === 'string') fetch.method = fetch.method.trim().toUpperCase();
    if (fetch.connectionId == null && typeof fetch.connection_id === 'string') {
      fetch.connectionId = fetch.connection_id;
    }
    record.fetch = fetch;
  }
  if (record.notify && typeof record.notify === 'object' && !Array.isArray(record.notify)) {
    const notify = { ...(record.notify as Record<string, unknown>) };
    notify.skipIfEmpty = asBoolean(notify.skipIfEmpty);
    record.notify = notify;
  }
  record.runOnceNow = asBoolean(record.runOnceNow);
  record.allowExternalAuto = asBoolean(record.allowExternalAuto);
  return record;
}

export const AxJobProposeArgsSchema = z.object({
  name: z.string().trim().min(1).max(120),
  goal: z.string().trim().min(1).max(2_000),
  schedule: z.object({
    cron: z.string().trim().min(1).max(80).optional(),
    timezone: z.string().trim().min(1).max(80).optional(),
  }).optional(),
  fetch: z.object({
    method: z.enum(['GET']).default('GET'),
    path: z.string().trim().min(1).max(2_000).optional(),
    connectionId: z.string().trim().min(1).max(80).optional(),
    headers: z.record(z.string().max(500)).optional(),
  }).optional(),
  interpret: z.object({
    goal: z.string().trim().min(1).max(4_000).optional(),
  }).optional(),
  notify: z.object({
    connector: z.literal('slack').default('slack'),
    channel: z.string().trim().min(1).max(200).optional(),
    skipIfEmpty: z.boolean().default(true),
  }).optional(),
  runOnceNow: z.boolean().default(true),
  allowExternalAuto: z.boolean().default(true),
});

export const AxJobCommitArgsSchema = z.object({});

export type AxJobProposeArgs = z.infer<typeof AxJobProposeArgsSchema>;

export interface NormalizedJobSpec {
  name: string;
  goal: string;
  cron: string;
  timezone: string;
  path: string;
  connectionId: string;
  httpLabel?: string;
  headers?: Record<string, string>;
  interpretGoal: string;
  channel: string;
  skipIfEmpty: boolean;
  runOnceNow: boolean;
  allowExternalAuto: boolean;
}

export interface PendingJobDraft {
  spec: NormalizedJobSpec;
  ir: WorkflowIR;
}

export interface JobProposeReadResult {
  ok: boolean;
  data?: unknown;
  error?: string;
}

export type ListSlackChannels = () => Promise<JobProposeReadResult>;
