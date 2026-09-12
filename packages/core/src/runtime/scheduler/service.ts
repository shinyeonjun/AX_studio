import type { WorkflowStore } from '../../persistence/workflow-store.js';
import type { WorkflowIR } from '../../workflow/schema.js';
import type { WorkflowRuntime } from '../engine.js';
import type { ExecutionResult } from '../types.js';
import { createCronMatcher } from './cron.js';
import { hasAttemptedExternalEffect } from '../execution/external-effect.js';

function minuteKey(date = new Date()): string {
  return date.toISOString().slice(0, 16);
}

type PendingOccurrence = {
  workflowId: string;
  occurrenceKey: string;
  triggerType: 'once' | 'schedule';
  workflowVersion?: number;
  triggerSnapshot?: string;
};

const PENDING_OCCURRENCES_SETTING = 'scheduler.pendingOccurrences';
const LAST_OBSERVED_SETTING = 'scheduler.lastObservedAt';
const MAX_CATCH_UP_MINUTES = 24 * 60;

export class Scheduler {
  private timer?: ReturnType<typeof setInterval>;
  private tickMs = 30_000;
  private lifecycleGeneration = 0;
  private tickInProgress = false;

  constructor(
    private store: WorkflowStore,
    private runtime: WorkflowRuntime,
    private onScheduledRun?: (workflowId: string, result: unknown) => void,
  ) {}

  start() {
    if (this.timer) return;
    this.lifecycleGeneration += 1;
    this.timer = setInterval(() => this.tick(), this.tickMs);
    void this.tick();
  }

  stop() {
    this.lifecycleGeneration += 1;
    clearInterval(this.timer);
    this.timer = undefined;
  }

  private lastFired(): Record<string, string> {
    const stored = this.store.getSetting<unknown>('scheduler.lastFired', {});
    if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return {};

    return Object.fromEntries(
      Object.entries(stored).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
    );
  }

  private markFired(workflowId: string, occurrenceKey: string) {
    const fired = this.lastFired();
    fired[workflowId] = occurrenceKey;
    this.store.setSetting('scheduler.lastFired', fired);
  }

  private pendingOccurrences(): PendingOccurrence[] {
    const stored = this.store.getSetting<unknown>(PENDING_OCCURRENCES_SETTING, []);
    if (!Array.isArray(stored)) return [];
    return stored.filter((entry): entry is PendingOccurrence => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return false;
      const candidate = entry as Record<string, unknown>;
      return typeof candidate.workflowId === 'string' &&
        typeof candidate.occurrenceKey === 'string' &&
        (candidate.triggerType === 'once' || candidate.triggerType === 'schedule');
    });
  }

  private savePendingOccurrences(occurrences: PendingOccurrence[]): void {
    this.store.setSetting(PENDING_OCCURRENCES_SETTING, occurrences);
  }

  private lastObservedAt(): Date | undefined {
    const value = this.store.getSetting<unknown>(LAST_OBSERVED_SETTING, undefined);
    if (typeof value !== 'string') return undefined;
    const timestamp = Date.parse(value);
    return Number.isFinite(timestamp) ? new Date(timestamp) : undefined;
  }

  private removePendingOccurrence(occurrence: PendingOccurrence): void {
    this.savePendingOccurrences(this.pendingOccurrences().filter((item) =>
      item.workflowId !== occurrence.workflowId || item.occurrenceKey !== occurrence.occurrenceKey,
    ));
  }

  private enqueueDueOccurrences(now: Date): void {
    const pending = this.pendingOccurrences();
    const pendingKeys = new Set(pending.map((entry) => `${entry.workflowId}:${entry.occurrenceKey}`));
    const fired = this.lastFired();
    const additions: PendingOccurrence[] = [];
    const latestDueBySchedule = new Map<string, string | undefined>();
    const currentMinute = new Date(now);
    currentMinute.setSeconds(0, 0);
    const observed = this.lastObservedAt();
    const firstCatchUpMinute = observed && observed.getTime() < currentMinute.getTime()
      ? new Date(Math.max(observed.getTime() + 60_000, currentMinute.getTime() - MAX_CATCH_UP_MINUTES * 60_000))
      : currentMinute;
    firstCatchUpMinute.setSeconds(0, 0);

    for (const summary of this.store.listWorkflows()) {
      if (!summary.active) continue;
      const ir = this.store.getWorkflow(summary.id);
      if (!ir?.trigger) continue;

      let due = false;
      let triggerType: PendingOccurrence['triggerType'] = 'schedule';
      let occurrenceKey = minuteKey(now);
      if (ir.trigger.type === 'once') {
        const runAt = Date.parse(ir.trigger.runAt);
        due = Number.isFinite(runAt) && runAt <= now.getTime() && !fired[summary.id];
        triggerType = 'once';
      } else if (ir.trigger.type === 'schedule') {
        // Coalesce missed sleep/restart intervals to the latest due minute.
        // The current minute is always examined so a failed occurrence can
        // still be retried without waiting for another matching minute.
        const scheduleKey = JSON.stringify([ir.trigger.schedule, ir.trigger.timezone]);
        if (!latestDueBySchedule.has(scheduleKey)) {
          const matches = createCronMatcher(ir.trigger.schedule, ir.trigger.timezone);
          let latest: string | undefined;
          for (const candidate = new Date(currentMinute); candidate >= firstCatchUpMinute; candidate.setTime(candidate.getTime() - 60_000)) {
            if (matches(candidate)) {
              latest = minuteKey(candidate);
              break;
            }
          }
          latestDueBySchedule.set(scheduleKey, latest);
        }
        const latest = latestDueBySchedule.get(scheduleKey);
        if (latest) occurrenceKey = latest;
        due = latest !== undefined && fired[summary.id] !== occurrenceKey;
        triggerType = 'schedule';
      }

      const key = `${summary.id}:${occurrenceKey}`;
      if (due && !pendingKeys.has(key)) {
        additions.push({ workflowId: summary.id, occurrenceKey, triggerType,
          workflowVersion: ir.version, triggerSnapshot: JSON.stringify(ir.trigger) });
        pendingKeys.add(key);
      }
    }

    if (additions.length > 0) this.savePendingOccurrences([...pending, ...additions]);
    this.store.setSetting(LAST_OBSERVED_SETTING, currentMinute.toISOString());
  }

  private async executeScheduledWorkflow(
    ir: WorkflowIR,
    triggerType: 'once' | 'schedule',
  ): Promise<ExecutionResult | null> {
    try {
      return await this.runtime.executeWorkflow(ir, { triggerType });
    } catch (error) {
      console.error(`[scheduler] execution failed for workflow ${ir.id}:`, error);
      return null;
    }
  }

  private async tick() {
    if (this.tickInProgress) return;
    this.tickInProgress = true;
    try {
      await this.runTick();
    } catch (error) {
      console.error('[scheduler] tick failed:', error);
    } finally {
      this.tickInProgress = false;
    }
  }

  private async runTick() {
    const generation = this.lifecycleGeneration;
    const globalActive = this.store.getGlobalActive();
    if (!globalActive) return;

    this.enqueueDueOccurrences(new Date());
    const pending = this.pendingOccurrences();
    for (const occurrence of pending) {
      if (generation !== this.lifecycleGeneration || !this.store.getGlobalActive()) return;
      const active = this.store.isWorkflowActive(occurrence.workflowId);
      if (!active) {
        this.removePendingOccurrence(occurrence);
        continue;
      }
      const ir = this.store.getWorkflow(occurrence.workflowId);
      if (!ir?.trigger || ir.trigger.type !== occurrence.triggerType ||
        (occurrence.workflowVersion !== undefined && occurrence.workflowVersion !== ir.version) ||
        (occurrence.triggerSnapshot !== undefined && occurrence.triggerSnapshot !== JSON.stringify(ir.trigger))) {
        this.removePendingOccurrence(occurrence);
        continue;
      }

      const result = await this.executeScheduledWorkflow(ir, occurrence.triggerType);
      if (!result) {
        this.removePendingOccurrence(occurrence);
        continue;
      }
      // Stopping prevents new work; it must not erase acknowledgement of work already completed.
      const current = this.store.getWorkflow(occurrence.workflowId);
      const unchanged = current?.version === ir.version && JSON.stringify(current.trigger) === JSON.stringify(ir.trigger);
      const unsafeToRetry = result.status === 'failed' && hasAttemptedExternalEffect(result);
      if (occurrence.triggerType === 'once') {
        if ((result.status === 'pending_approval' || unsafeToRetry) && unchanged) {
          // Pending runs resume through approval. An uncertain failed send needs
          // user inspection before reactivation; neither may automatically retry.
          this.store.setWorkflowActive(occurrence.workflowId, false);
        }
        if (result.status === 'success' && unchanged) {
          this.markFired(occurrence.workflowId, occurrence.occurrenceKey);
          this.store.setWorkflowActive(occurrence.workflowId, false);
          this.store.deleteWorkflow(occurrence.workflowId, { preserveExecutions: true });
          this.runtime.removeWorkflow(occurrence.workflowId);
        }
      } else if ((result.status !== 'failed' || unsafeToRetry) && unchanged) {
        this.markFired(occurrence.workflowId, occurrence.occurrenceKey);
      }

      this.removePendingOccurrence(occurrence);
      this.onScheduledRun?.(occurrence.workflowId, result);
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
