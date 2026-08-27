import type { WorkflowStore } from '../store/workflow-store.js';
import type { WorkflowIR } from '../workflow/schema.js';
import { parseCronExpression } from '../workflow/cron.js';
import type { WorkflowRuntime } from '../runtime/engine.js';

export interface ScheduledJob {
  workflowId: string;
  schedule: string;
  timezone: string;
  nextRunAt?: string;
}

function zonedDateParts(date: Date, timeZone: string): { minute: number; hour: number; day: number; month: number; weekday: number } | null {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      weekday: 'short',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      hourCycle: 'h23',
    }).formatToParts(date);
    const values = new Map(parts.map((part) => [part.type, part.value]));
    const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(values.get('weekday') ?? '');
    const minute = Number(values.get('minute'));
    const hour = Number(values.get('hour'));
    const day = Number(values.get('day'));
    const month = Number(values.get('month'));
    if ([weekday, minute, hour, day, month].some((value) => !Number.isInteger(value)) || weekday < 0) return null;
    return { minute, hour, day, month, weekday };
  } catch {
    return null;
  }
}

export function cronMatches(expr: string, date: Date, timeZone?: string): boolean {
  const parsed = parseCronExpression(expr);
  if (!parsed) return false;
  const current = timeZone
    ? zonedDateParts(date, timeZone)
    : {
        minute: date.getMinutes(),
        hour: date.getHours(),
        day: date.getDate(),
        month: date.getMonth() + 1,
        weekday: date.getDay(),
  };
  if (!current) return false;

  const dayMatches = parsed.day.has(current.day);
  const weekdayMatches = parsed.weekday.has(current.weekday);
  const calendarDayMatches = parsed.dayIsWildcard || parsed.weekdayIsWildcard
    ? dayMatches && weekdayMatches
    : dayMatches || weekdayMatches;
  return (
    parsed.minute.has(current.minute) &&
    parsed.hour.has(current.hour) &&
    calendarDayMatches &&
    parsed.month.has(current.month)
  );
}

function minuteKey(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}T${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

export class Scheduler {
  private timers: Map<string, ReturnType<typeof setInterval>> = new Map();
  private tickMs = 30_000;
  private lifecycleGeneration = 0;
  private tickInProgress = false;

  constructor(
    private store: WorkflowStore,
    private runtime: WorkflowRuntime,
    private onScheduledRun?: (workflowId: string, result: unknown) => void,
  ) {}

  start() {
    if (this.timers.has('main')) return;
    this.lifecycleGeneration += 1;
    const interval = setInterval(() => this.tick(), this.tickMs);
    this.timers.set('main', interval);
    void this.tick();
  }

  stop() {
    this.lifecycleGeneration += 1;
    for (const t of this.timers.values()) clearInterval(t);
    this.timers.clear();
  }

  private lastFired(): Record<string, string> {
    return this.store.getSetting<Record<string, string>>('scheduler.lastFired', {});
  }

  private markFired(workflowId: string) {
    const fired = this.lastFired();
    fired[workflowId] = minuteKey();
    this.store.setSetting('scheduler.lastFired', fired);
  }

  private alreadyFiredThisMinute(workflowId: string): boolean {
    return this.lastFired()[workflowId] === minuteKey();
  }

  private async tick() {
    if (this.tickInProgress) return;
    this.tickInProgress = true;
    try {
      await this.runTick();
    } finally {
      this.tickInProgress = false;
    }
  }

  private async runTick() {
    const generation = this.lifecycleGeneration;
    const globalActive = this.store.getSetting<boolean>('globalActive', true);
    if (!globalActive) return;

    const works = this.store.listWorkflows();
    for (const s of works) {
      if (generation !== this.lifecycleGeneration) return;
      if (!s.active) continue;
      const ir = this.store.getWorkflow(s.id);
      if (!ir?.trigger) continue;

      if (ir.trigger.type === 'once') {
        const runAt = Date.parse(ir.trigger.runAt);
        if (!Number.isFinite(runAt) || runAt > Date.now()) continue;
        if (this.alreadyFiredThisMinute(s.id) || this.lastFired()[s.id]) continue;
        if (generation !== this.lifecycleGeneration) return;
        const result = await this.runtime.executeWorkflow(ir, { triggerType: 'once' });
        if (generation !== this.lifecycleGeneration) return;
        if (result.status === 'pending_approval') {
          // Deactivate without marking lastFired so reactivating the job can
          // fire it again; the paused execution resumes through approval.
          this.store.setWorkflowActive(s.id, false);
        }
        if (result.status === 'success') {
          this.markFired(s.id);
          this.store.setWorkflowActive(s.id, false);
          this.store.deleteWorkflow(s.id);
          this.runtime.removeWorkflow(s.id);
        }
        this.onScheduledRun?.(s.id, result);
        continue;
      }

      if (ir.trigger.type !== 'schedule') continue;
      if (!cronMatches(ir.trigger.schedule, new Date(), ir.trigger.timezone)) continue;
      if (this.alreadyFiredThisMinute(s.id)) continue;
      if (generation !== this.lifecycleGeneration) return;
      const result = await this.runtime.executeWorkflow(ir, { triggerType: 'schedule' });
      if (generation !== this.lifecycleGeneration) return;
      if (result.status !== 'failed') this.markFired(s.id);
      this.onScheduledRun?.(s.id, result);
    }
  }

  async runWorkflowNow(workflowId: string): Promise<unknown> {
    const ir = this.store.getWorkflow(workflowId);
    if (!ir) throw new Error('Workflow not found');
    return this.runtime.executeWorkflow(ir, { triggerType: 'manual' });
  }

  persistWorkflowFromEphemeral(ir: WorkflowIR, trigger?: WorkflowIR['trigger']): string {
    const withTrigger = { ...ir, trigger: trigger ?? ir.trigger };
    const { workflowId } = this.store.saveWorkflow(withTrigger);
    return workflowId;
  }
}
