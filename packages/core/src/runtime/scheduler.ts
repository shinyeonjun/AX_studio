import type { WorkflowStore } from '../store/workflow-store.js';
import type { WorkflowIR } from '../workflow/schema.js';
import type { WorkflowRuntime } from '../runtime/engine.js';

export interface ScheduledJob {
  workflowId: string;
  schedule: string;
  timezone: string;
  nextRunAt?: string;
}

function cronFieldMatches(field: string, value: number): boolean {
  if (field === '*') return true;
  return field.split(',').some((part) => Number(part) === value);
}

export function cronMatches(expr: string, date: Date): boolean {
  const parts = expr.trim().split(/\s+/);
  if (parts.length < 5) return false;
  const [minute, hour, day, month, weekday] = parts;
  return (
    cronFieldMatches(minute, date.getMinutes()) &&
    cronFieldMatches(hour, date.getHours()) &&
    cronFieldMatches(day, date.getDate()) &&
    cronFieldMatches(month, date.getMonth() + 1) &&
    cronFieldMatches(weekday, date.getDay())
  );
}

function minuteKey(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}T${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

export class Scheduler {
  private timers: Map<string, ReturnType<typeof setInterval>> = new Map();
  private tickMs = 30_000;

  constructor(
    private store: WorkflowStore,
    private runtime: WorkflowRuntime,
    private onScheduledRun?: (workflowId: string, result: unknown) => void,
  ) {}

  start() {
    const interval = setInterval(() => this.tick(), this.tickMs);
    this.timers.set('main', interval);
  }

  stop() {
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
    const globalActive = this.store.getSetting<boolean>('globalActive', true);
    if (!globalActive) return;

    const works = this.store.listWorkflows();
    for (const s of works) {
      if (!s.active) continue;
      const ir = this.store.getWorkflow(s.id);
      if (!ir?.trigger) continue;

      if (ir.trigger.type === 'once') {
        if (Date.parse(ir.trigger.runAt) > Date.now()) continue;
        if (this.alreadyFiredThisMinute(s.id) || this.lastFired()[s.id]) continue;
        this.markFired(s.id);
        this.store.setWorkflowActive(s.id, false);
        const result = await this.runtime.executeWorkflow(ir, { triggerType: 'once' });
        if (result.status === 'success') {
          this.store.deleteWorkflow(s.id);
          this.runtime.removeWorkflow(s.id);
        }
        this.onScheduledRun?.(s.id, result);
        continue;
      }

      if (ir.trigger.type !== 'schedule') continue;
      if (!cronMatches(ir.trigger.schedule, new Date())) continue;
      if (this.alreadyFiredThisMinute(s.id)) continue;
      this.markFired(s.id);
      const result = await this.runtime.executeWorkflow(ir, { triggerType: 'schedule' });
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
    const { workflowId } = this.store.saveWorkflow(withTrigger as WorkflowIR);
    return workflowId;
  }
}
