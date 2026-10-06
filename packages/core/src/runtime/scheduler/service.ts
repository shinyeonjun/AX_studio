import type { WorkflowStore } from '../../persistence/workflow-store.js';
import type { WorkflowIR } from '../../workflow/schema.js';
import type { WorkflowRuntime } from '../engine.js';
import type { ExecutionResult } from '../types.js';
import { CompiledScheduleCache } from './schedule-match.js';

function minuteKey(date = new Date()): string {
  return date.toISOString().slice(0, 16);
}

/** Occurrence keys are UTC minutes (`YYYY-MM-DDTHH:MM`); compare them as instants. */
function occurrenceTime(key: string): number | undefined {
  const timestamp = Date.parse(`${key}:00Z`);
  return Number.isFinite(timestamp) ? timestamp : undefined;
}

/**
 * True when the durable checkpoint already covers this occurrence. A checkpoint
 * in the future (the wall clock was set backwards) only suppresses its exact
 * occurrence, so schedules resume instead of stalling until the clock catches up.
 */
function occurrenceAcknowledged(fired: string | undefined, occurrenceKey: string, now: number): boolean {
  if (!fired) return false;
  if (fired === occurrenceKey) return true;
  const firedAt = occurrenceTime(fired);
  const occurrenceAt = occurrenceTime(occurrenceKey);
  if (firedAt === undefined || occurrenceAt === undefined) return false;
  if (firedAt > now + 60_000) return false;
  return firedAt >= occurrenceAt;
}

/** Runtime refusals that are raised before any step runs, so the occurrence may be retried. */
const NOT_STARTED_ERRORS = new Set([
  'runtime_stopping', 'workflow_removed', 'workflow_run_queue_full', 'workflow_already_running',
]);

/** A one-time job this late is skipped (and recorded) instead of running unexpectedly. */
export const ONCE_MAX_LATENESS_MS = 24 * 60 * 60 * 1_000;

type PendingOccurrence = {
  workflowId: string;
  occurrenceKey: string;
  triggerType: 'once' | 'schedule';
  workflowVersion?: number;
  triggerSnapshot?: string;
};

export type SchedulerOccurrenceOutcome = OccurrenceOutcome;

type OccurrenceOutcome = {
  occurrenceKey: string;
  status: ExecutionResult['status'] | 'skipped';
  reason?: string;
  executionId?: string;
  at: string;
};

const PENDING_OCCURRENCES_SETTING = 'scheduler.pendingOccurrences';
const LAST_OBSERVED_SETTING = 'scheduler.lastObservedAt';
const LAST_FIRED_SETTING = 'scheduler.lastFired';
const LAST_FIRED_SETTING_PREFIX = `${LAST_FIRED_SETTING}:`;
/** Last failed/skipped occurrence per workflow, kept apart from the fired checkpoint. */
export const LAST_OUTCOME_SETTING_PREFIX = 'scheduler.lastOutcome:';

export class Scheduler {
  private timer?: ReturnType<typeof setInterval>;
  private tickMs = 30_000;
  private lifecycleGeneration = 0;
  private tickInProgress = false;
  private activeTick?: Promise<void>;
  /** Runs started by a tick, per workflow; a tick never waits on them. */
  private readonly inFlight = new Map<string, Promise<void>>();
  private readonly schedules = new CompiledScheduleCache();

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
    await Promise.allSettled([...this.inFlight.values()]);
    this.flushSettled();
  }

  private beginTick(): void {
    if (this.tickInProgress) return;
    const tick = this.tick(false);
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

  /** Re-arms a one-time job so reactivating (or a replaced trigger) can fire it again. */
  private clearFired(fired: Record<string, string>, workflowId: string) {
    delete fired[workflowId];
    this.store.deleteSetting(`${LAST_FIRED_SETTING_PREFIX}${encodeURIComponent(workflowId)}`);
  }

  private recordOutcome(workflowId: string, outcome: Omit<OccurrenceOutcome, 'at'>): void {
    try {
      this.store.setSetting(`${LAST_OUTCOME_SETTING_PREFIX}${encodeURIComponent(workflowId)}`, {
        ...outcome,
        at: new Date().toISOString(),
      } satisfies OccurrenceOutcome);
    } catch (error) {
      console.error(`[scheduler] failed to record outcome for workflow ${workflowId}:`, error);
    }
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

    const activeDefinitions = this.store.listActiveWorkflowDefinitions();
    this.schedules.retain(new Set(activeDefinitions.map(({ id }) => id)));
    for (const { id, workflow: ir } of activeDefinitions) {
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
        const latestMatch = this.schedules.get(id, ir.version, ir.trigger)(firstCatchUpMinute, currentMinute);
        if (!latestMatch) continue;
        occurrenceKey = minuteKey(latestMatch);
        due = !occurrenceAcknowledged(fired[id], occurrenceKey, now.getTime());
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
  ): Promise<{ result: ExecutionResult } | { error: unknown; notStarted: boolean; code?: string }> {
    try {
      return { result: await this.runtime.executeWorkflow(ir, { triggerType }) };
    } catch (error) {
      console.error(`[scheduler] execution failed for workflow ${ir.id}:`, error);
      const code = (error as { code?: unknown })?.code ?? (error instanceof Error ? error.message : undefined);
      return {
        error,
        notStarted: typeof code === 'string' && NOT_STARTED_ERRORS.has(code),
        ...(typeof code === 'string' ? { code } : {}),
      };
    }
  }

  /**
   * One scheduling pass. The pass itself is exclusive, but the runs it starts are not: the timer
   * moves on while they execute. `waitForRuns` (the default, used by direct callers) also waits for
   * the runs this pass started.
   */
  private async tick(waitForRuns = true) {
    if (this.tickInProgress) return;
    this.tickInProgress = true;
    let started: Promise<void>[] = [];
    try {
      started = await this.runTick();
    } catch (error) {
      console.error('[scheduler] tick failed:', error);
    } finally {
      this.tickInProgress = false;
    }
    if (waitForRuns) await Promise.allSettled(started);
    this.flushSettled();
  }

  /** Periodic approval TTL sweep; harmless while execution is globally paused. */
  private expireStaleApprovals(): void {
    if (typeof this.runtime.expireStaleApprovals !== 'function') return;
    this.runtime.expireStaleApprovals();
  }

  /** Deactivates a one-time job after a terminal non-success so it is never retried every tick. */
  private retireOnceJob(fired: Record<string, string>, workflowId: string): void {
    this.store.setWorkflowActive(workflowId, false);
    this.clearFired(fired, workflowId);
  }

  /**
   * While execution is switched off (퇴근), schedules do not accumulate: the observation window
   * keeps moving and queued schedule occurrences are recorded as skipped, so switching back on
   * does not fire the morning's runs in the evening. One-time jobs keep their own lateness rule.
   */
  private skipWhilePaused(now: Date): void {
    const currentMinute = new Date(now);
    currentMinute.setSeconds(0, 0);
    this.store.setSetting(LAST_OBSERVED_SETTING, currentMinute.toISOString());
    const skipped = this.pendingOccurrences().filter((occurrence) =>
      occurrence.triggerType === 'schedule' && !this.inFlight.has(occurrence.workflowId));
    for (const occurrence of skipped) {
      this.recordOutcome(occurrence.workflowId, {
        occurrenceKey: occurrence.occurrenceKey, status: 'skipped', reason: 'execution_paused',
      });
    }
    this.removePending(new Set(skipped.map(pendingKeyOf)));
  }

  /** Read-modify-write of the durable queue; synchronous, so ticks and finishing runs never clobber each other. */
  private removePending(keys: ReadonlySet<string>): void {
    if (keys.size === 0) return;
    this.savePendingOccurrences(this.pendingOccurrences().filter((occurrence) => !keys.has(pendingKeyOf(occurrence))));
  }

  /**
   * Queue entries that are finished (run settled, or dropped by a pass), removed in one write.
   * Until flushed an entry is harmless: its occurrence is already acknowledged in lastFired.
   */
  private readonly settledKeys = new Set<string>();

  private flushTimer?: ReturnType<typeof setTimeout>;

  /** Runs finishing together are cleaned up in one write, right after they settle. */
  private scheduleFlush(): void {
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = undefined;
      this.flushSettled();
    }, 0);
    this.flushTimer.unref?.();
  }

  private flushSettled(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = undefined;
    }
    if (this.settledKeys.size === 0) return;
    const keys = new Set(this.settledKeys);
    this.settledKeys.clear();
    this.removePending(keys);
  }

  private async runTick(): Promise<Promise<void>[]> {
    const generation = this.lifecycleGeneration;
    this.expireStaleApprovals();
    const now = new Date();
    const started: Promise<void>[] = [];
    // Runs that finished since the last pass leave the queue before it is read again.
    this.flushSettled();
    if (!this.store.getGlobalActive()) {
      this.skipWhilePaused(now);
      return started;
    }

    const { pending: scheduledPending, fired } = this.enqueueDueOccurrences(now);
    const dropped = this.settledKeys;
    const seen = new Set<string>();
    for (const occurrence of scheduledPending) {
      if (generation !== this.lifecycleGeneration || !this.store.getGlobalActive()) break;
      const pendingKey = pendingKeyOf(occurrence);
      if (seen.has(pendingKey)) continue;
      seen.add(pendingKey);
      // A workflow already running keeps its later occurrences queued; they are looked at again
      // once it finishes, without holding up other workflows' schedules.
      if (this.inFlight.has(occurrence.workflowId)) continue;
      // lastFired is the durable acknowledgement; a crash may leave its pending
      // row behind, so discard any occurrence at or below that checkpoint.
      if (occurrenceAcknowledged(fired[occurrence.workflowId], occurrence.occurrenceKey, now.getTime())) {
        dropped.add(pendingKey);
        continue;
      }
      if (!this.store.isWorkflowActive(occurrence.workflowId)) {
        dropped.add(pendingKey);
        continue;
      }
      const ir = this.store.getWorkflow(occurrence.workflowId);
      // The occurrence belongs to the schedule: edited steps (a new version) still run at this
      // slot, but a replaced trigger means this slot is no longer wanted.
      if (!ir?.trigger || ir.trigger.type !== occurrence.triggerType ||
        (occurrence.triggerSnapshot !== undefined && occurrence.triggerSnapshot !== JSON.stringify(ir.trigger))) {
        if (ir) {
          this.recordOutcome(occurrence.workflowId, {
            occurrenceKey: occurrence.occurrenceKey, status: 'skipped', reason: 'schedule_changed',
          });
        }
        dropped.add(pendingKey);
        continue;
      }

      if (ir.trigger.type === 'once') {
        const lateness = now.getTime() - Date.parse(ir.trigger.runAt);
        if (lateness > ONCE_MAX_LATENESS_MS) {
          console.warn(`[scheduler] skipped one-time workflow ${occurrence.workflowId}: ${Math.round(lateness / 60_000)} minutes late`);
          this.retireOnceJob(fired, occurrence.workflowId);
          this.recordOutcome(occurrence.workflowId, {
            occurrenceKey: occurrence.occurrenceKey, status: 'skipped', reason: 'max_lateness_exceeded',
          });
          dropped.add(pendingKey);
          continue;
        }
      }

      // Do not stack runs behind an unanswered approval of the same workflow.
      if (this.store.hasPendingApprovalForWorkflow(occurrence.workflowId)) {
        if (occurrence.triggerType === 'schedule') {
          console.info(`[scheduler] skipped occurrence ${occurrence.occurrenceKey} of workflow ${occurrence.workflowId}: approval pending`);
          this.markFired(fired, occurrence.workflowId, occurrence.occurrenceKey);
          this.recordOutcome(occurrence.workflowId, {
            occurrenceKey: occurrence.occurrenceKey, status: 'skipped', reason: 'approval_pending',
          });
          dropped.add(pendingKey);
        }
        // A one-time job waits (without retrying side effects) until the approval is answered.
        continue;
      }

      // Acknowledge before starting: once an execution may have produced side
      // effects, a failure, crash or stop must never run this occurrence again.
      const previousFired = fired[occurrence.workflowId];
      this.markFired(fired, occurrence.workflowId, occurrence.occurrenceKey);
      const run = this.runOccurrence(occurrence, ir, fired, previousFired, generation);
      this.inFlight.set(occurrence.workflowId, run);
      started.push(run);
      void run.finally(() => {
        if (this.inFlight.get(occurrence.workflowId) === run) this.inFlight.delete(occurrence.workflowId);
        this.scheduleFlush();
      });
    }
    // Entries the pass dropped leave the queue now (one write, shared with runs that already settled).
    if (started.length === 0) this.flushSettled();
    return started;
  }

  /** Runs one acknowledged occurrence to its end and settles its queue entry and checkpoint. */
  private async runOccurrence(
    occurrence: PendingOccurrence,
    ir: WorkflowIR,
    fired: Record<string, string>,
    previousFired: string | undefined,
    generation: number,
  ): Promise<void> {
    const pendingKey = pendingKeyOf(occurrence);
    try {
      const outcome = await this.executeScheduledWorkflow(ir, occurrence.triggerType);
      if ('error' in outcome) {
        if (outcome.notStarted) {
          // The runtime refused before any step ran; re-arm the occurrence and keep it queued so
          // a later tick (or the next app start) runs it. A removed workflow has nothing to run.
          if (previousFired === undefined) this.clearFired(fired, occurrence.workflowId);
          else this.markFired(fired, occurrence.workflowId, previousFired);
          if (outcome.code !== 'workflow_removed') return;
        } else {
          // The run may have reached a side effect before failing; never retry it.
          this.recordOutcome(occurrence.workflowId, {
            occurrenceKey: occurrence.occurrenceKey, status: 'failed', reason: 'execution_error',
          });
          if (occurrence.triggerType === 'once') this.retireOnceJob(fired, occurrence.workflowId);
        }
        this.settledKeys.add(pendingKey);
        return;
      }
      const { result } = outcome;
      this.settledKeys.add(pendingKey);
      if (generation !== this.lifecycleGeneration) return;
      const current = this.store.getWorkflow(occurrence.workflowId);
      const triggerUnchanged = JSON.stringify(current?.trigger) === JSON.stringify(ir.trigger);
      const unchanged = current?.version === ir.version && triggerUnchanged;
      if (result.status !== 'success' && result.status !== 'pending_approval') {
        console.warn(`[scheduler] ${occurrence.triggerType} occurrence ${occurrence.occurrenceKey} of workflow ${occurrence.workflowId} ended as ${result.status}${result.errorCode ? ` (${result.errorCode})` : ''}; not retrying`);
        this.recordOutcome(occurrence.workflowId, {
          occurrenceKey: occurrence.occurrenceKey, status: result.status,
          ...(result.errorCode ? { reason: result.errorCode } : {}), executionId: result.executionId,
        });
      }
      if (!triggerUnchanged) {
        // The trigger was replaced during the run; its new schedule must still fire.
        // (A version bump alone keeps the acknowledgement so nothing re-runs.)
        this.clearFired(fired, occurrence.workflowId);
      } else if (occurrence.triggerType === 'once') {
        if (result.status === 'success') {
          if (unchanged && this.store.claimWorkflowDeletion(occurrence.workflowId, ir.version)) {
            try {
              this.store.setWorkflowActive(occurrence.workflowId, false);
              await this.runtime.removeWorkflow(occurrence.workflowId);
              this.store.deleteWorkflow(occurrence.workflowId);
            } finally {
              this.store.releaseWorkflowDeletion(occurrence.workflowId);
            }
          }
        } else {
          // Pending approval resumes through the approval; failures surface in
          // history. Either way deactivate so reactivating can fire it again.
          this.retireOnceJob(fired, occurrence.workflowId);
        }
      }
      this.onScheduledRun?.(occurrence.workflowId, result);
    } catch (error) {
      console.error(`[scheduler] settling occurrence ${occurrence.occurrenceKey} of workflow ${occurrence.workflowId} failed:`, error);
    }
  }
}

function pendingKeyOf(occurrence: Pick<PendingOccurrence, 'workflowId' | 'occurrenceKey'>): string {
  return JSON.stringify([occurrence.workflowId, occurrence.occurrenceKey]);
}
