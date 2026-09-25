import type { WorkflowStore } from '../../persistence/workflow-store.js';
import type { WorkflowIR } from '../../workflow/schema.js';
import type { WorkflowRuntime } from '../engine.js';
import type { ExecutionResult } from '../types.js';
import { findLatestCronMatch } from './cron.js';

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
const LAST_FIRED_SETTING = 'scheduler.lastFired';
const LAST_FIRED_SETTING_PREFIX = `${LAST_FIRED_SETTING}:`;

export class Scheduler {
  private timer?: ReturnType<typeof setInterval>;
  private tickMs = 30_000;
  private lifecycleGeneration = 0;
  private tickInProgress = false;
  private activeTick?: Promise<void>;

  constructor(
    private store: WorkflowStore,
    private runtime: WorkflowRuntime,
    private onScheduledRun?: (workflowId: string, result: unknown) => void,
  ) {}

  start() {
    if (this.timer) return;
    this.lifecycleGeneration += 1;
    this.timer = setInterval(() => this.beginTick(), this.tickMs);
    this.beginTick();
  }

  async stop(): Promise<void> {
    this.lifecycleGeneration += 1;
    clearInterval(this.timer);
    this.timer = undefined;
    await this.activeTick;
  }

  private beginTick(): void {
    if (this.tickInProgress) return;
    const tick = this.tick();
    this.activeTick = tick;
    void tick.finally(() => {
      if (this.activeTick === tick) this.activeTick = undefined;
    });
  }

  private lastFired(): Record<string, string> {
    const fired = Object.create(null) as Record<string, string>;
    for (const { key, value } of this.store.listSettingsByPrefix(LAST_FIRED_SETTING_PREFIX)) {
      if (typeof value !== 'string') continue;
      try {
        fired[decodeURIComponent(key.slice(LAST_FIRED_SETTING_PREFIX.length))] = value;
      } catch {
        // Ignore invalid internal keys; valid workflow IDs are URI-encoded on write.
      }
    }

    const legacy = this.store.getSetting<unknown>(LAST_FIRED_SETTING, {});
    if (legacy && typeof legacy === 'object' && !Array.isArray(legacy)) {
      for (const [workflowId, occurrenceKey] of Object.entries(legacy)) {
        if (typeof occurrenceKey !== 'string' || fired[workflowId] !== undefined) continue;
        fired[workflowId] = occurrenceKey;
        this.store.setSetting(`${LAST_FIRED_SETTING_PREFIX}${encodeURIComponent(workflowId)}`, occurrenceKey);
      }
    }
    this.store.deleteSetting(LAST_FIRED_SETTING);
    return fired;
  }

  private markFired(fired: Record<string, string>, workflowId: string, occurrenceKey: string) {
    fired[workflowId] = occurrenceKey;
    this.store.setSetting(`${LAST_FIRED_SETTING_PREFIX}${encodeURIComponent(workflowId)}`, occurrenceKey);
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

  private enqueueDueOccurrences(now: Date): { pending: PendingOccurrence[]; fired: Record<string, string> } {
    let pending = this.pendingOccurrences();
    const pendingKeys = new Set(pending.map((entry) => `${entry.workflowId}:${entry.occurrenceKey}`));
    const fired = this.lastFired();
    const additions: PendingOccurrence[] = [];
    const currentMinute = new Date(now);
    currentMinute.setSeconds(0, 0);
    const observed = this.lastObservedAt();
    const firstCatchUpMinute = observed && observed.getTime() < currentMinute.getTime()
      ? new Date(observed.getTime() + 60_000)
      : currentMinute;
    firstCatchUpMinute.setSeconds(0, 0);

    for (const { id, workflow: ir } of this.store.listActiveWorkflowDefinitions()) {
      if (!ir?.trigger) continue;

      let due = false;
      let triggerType: PendingOccurrence['triggerType'] = 'schedule';
      let occurrenceKey = minuteKey(now);
      if (ir.trigger.type === 'once') {
        const runAt = Date.parse(ir.trigger.runAt);
        due = Number.isFinite(runAt) && runAt <= now.getTime() && !fired[id];
        triggerType = 'once';
      } else if (ir.trigger.type === 'schedule') {
        // Coalesce missed sleep/restart intervals to the latest due minute.
        // The current minute is always examined so a failed occurrence can
        // still be retried without waiting for another matching minute.
        const latestMatch = findLatestCronMatch(
          ir.trigger.schedule,
          firstCatchUpMinute,
          currentMinute,
          ir.trigger.timezone,
        );
        if (!latestMatch) continue;
        occurrenceKey = minuteKey(latestMatch);
        due = true;
        due = due && fired[id] !== occurrenceKey;
        triggerType = 'schedule';
      }

      const key = `${id}:${occurrenceKey}`;
      if (due && !pendingKeys.has(key)) {
        additions.push({ workflowId: id, occurrenceKey, triggerType,
          workflowVersion: ir.version, triggerSnapshot: JSON.stringify(ir.trigger) });
        pendingKeys.add(key);
      }
    }

    if (additions.length > 0) {
      pending = [...pending, ...additions];
      this.savePendingOccurrences(pending);
    }
    this.store.setSetting(LAST_OBSERVED_SETTING, currentMinute.toISOString());
    return { pending, fired };
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

    const { pending: scheduledPending, fired } = this.enqueueDueOccurrences(new Date());
    const removedPendingKeys = new Set<string>();
    const processedPendingKeys = new Set<string>();
    let pendingChanged = false;
    for (const occurrence of scheduledPending) {
      if (generation !== this.lifecycleGeneration || !this.store.getGlobalActive()) return;
      const pendingKey = JSON.stringify([occurrence.workflowId, occurrence.occurrenceKey]);
      if (processedPendingKeys.has(pendingKey)) continue;
      processedPendingKeys.add(pendingKey);
      // lastFired is the durable acknowledgement; a crash may leave its pending
      // row behind, so discard any occurrence at or below that checkpoint.
      if (fired[occurrence.workflowId] && fired[occurrence.workflowId]! >= occurrence.occurrenceKey) {
        removedPendingKeys.add(pendingKey);
        pendingChanged = true;
        continue;
      }
      const active = this.store.isWorkflowActive(occurrence.workflowId);
      if (!active) {
        removedPendingKeys.add(pendingKey);
        pendingChanged = true;
        continue;
      }
      const ir = this.store.getWorkflow(occurrence.workflowId);
      if (!ir?.trigger || ir.trigger.type !== occurrence.triggerType ||
        (occurrence.workflowVersion !== undefined && occurrence.workflowVersion !== ir.version) ||
        (occurrence.triggerSnapshot !== undefined && occurrence.triggerSnapshot !== JSON.stringify(ir.trigger))) {
        removedPendingKeys.add(pendingKey);
        pendingChanged = true;
        continue;
      }

      const result = await this.executeScheduledWorkflow(ir, occurrence.triggerType);
      if (generation !== this.lifecycleGeneration || !this.store.getGlobalActive()) return;
      if (!result) {
        removedPendingKeys.add(pendingKey);
        pendingChanged = true;
        continue;
      }
      // Stopping prevents new work; it must not erase acknowledgement of work already completed.
      const current = this.store.getWorkflow(occurrence.workflowId);
      const unchanged = current?.version === ir.version && JSON.stringify(current.trigger) === JSON.stringify(ir.trigger);
      if (occurrence.triggerType === 'once') {
        if (result.status === 'pending_approval' && unchanged) {
          // Deactivate without marking lastFired so reactivating the job can
          // fire it again; the paused execution resumes through approval.
          this.store.setWorkflowActive(occurrence.workflowId, false);
        }
        if (result.status === 'success' && unchanged) {
          if (this.store.claimWorkflowDeletion(occurrence.workflowId, ir.version)) {
            try {
              this.markFired(fired, occurrence.workflowId, occurrence.occurrenceKey);
              this.store.setWorkflowActive(occurrence.workflowId, false);
              await this.runtime.removeWorkflow(occurrence.workflowId);
              this.store.deleteWorkflow(occurrence.workflowId);
            } finally {
              this.store.releaseWorkflowDeletion(occurrence.workflowId);
            }
          }
        }
      } else if (result.status !== 'failed' && unchanged) {
        this.markFired(fired, occurrence.workflowId, occurrence.occurrenceKey);
      }

      removedPendingKeys.add(pendingKey);
      pendingChanged = true;
      this.onScheduledRun?.(occurrence.workflowId, result);
    }
    if (pendingChanged) {
      this.savePendingOccurrences(scheduledPending.filter((occurrence) =>
        !removedPendingKeys.has(JSON.stringify([occurrence.workflowId, occurrence.occurrenceKey])),
      ));
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
