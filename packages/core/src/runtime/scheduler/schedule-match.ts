import type { Trigger } from '../../workflow/schema.js';
import { findLatestOccurrence, validateRecurrence } from '../../workflow/schedule/occurrences.js';
import { findLatestCronMatch } from './cron.js';

type ScheduleTrigger = Extract<Trigger, { type: 'schedule' }>;

/** Latest due instant of a schedule trigger in [from, to], or undefined. */
export type CompiledSchedule = (from: Date, to: Date) => Date | undefined;

/**
 * Compiles a schedule trigger once. Recurrences are validated up front; legacy
 * cron strings run through the unchanged cron matcher so saved workflows keep
 * their exact behaviour. An unusable schedule compiles to "never due".
 */
export function compileSchedule(trigger: ScheduleTrigger): CompiledSchedule {
  if (trigger.recurrence) {
    const validated = validateRecurrence(trigger.recurrence);
    if (!validated.ok) return () => undefined;
    const rule = validated.recurrence;
    return (from, to) => findLatestOccurrence(rule, from, to);
  }
  const cron = trigger.schedule ?? '';
  const timezone = trigger.timezone;
  return (from, to) => findLatestCronMatch(cron, from, to, timezone);
}

/** Per-workflow compiled schedules, reused across scheduler ticks until the definition changes. */
export class CompiledScheduleCache {
  private readonly entries = new Map<string, { key: string; compiled: CompiledSchedule }>();

  get(workflowId: string, version: number | undefined, trigger: ScheduleTrigger): CompiledSchedule {
    const key = `${version ?? ''}:${JSON.stringify(trigger)}`;
    const cached = this.entries.get(workflowId);
    if (cached?.key === key) return cached.compiled;
    const compiled = compileSchedule(trigger);
    this.entries.set(workflowId, { key, compiled });
    return compiled;
  }

  /** Drops entries of workflows that are no longer active. */
  retain(activeWorkflowIds: ReadonlySet<string>): void {
    for (const workflowId of this.entries.keys()) {
      if (!activeWorkflowIds.has(workflowId)) this.entries.delete(workflowId);
    }
  }
}
