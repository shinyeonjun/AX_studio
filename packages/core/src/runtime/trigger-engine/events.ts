import { randomUUID } from 'node:crypto';
import type { WorkflowStore } from '../../persistence/workflow-store.js';
import type { WorkflowRuntime } from '../engine.js';
import { PUSH_TRIGGER_DRIVERS } from '../../connectors/packages/catalog.js';
import type { PushTriggerEvent } from '../../connectors/module-package.js';
import { matchesTriggerFilter } from '../../triggers/filter.js';
import type { TriggerEvent } from '../../triggers/types.js';
import type { WorkflowIR } from '../../workflow/schema.js';
import type { ExecutionResult } from '../types.js';
import {
  MAX_RECENT_EVENTS,
  cursorAfterPushedEvent,
  legacyEventDedupeKeys,
  triggerInputFromEvent,
  triggerRunWasAccepted,
} from './helpers.js';
import { updateTriggerCursor } from './poll/cursors.js';
import { clearTriggerAttempts, recordTriggerFailure, triggerErrorNotStarted } from './receipts.js';

const MAX_ACTIVE_PUSH_EVENTS = 16;
const MAX_QUEUED_PUSH_EVENTS = 128;
/** A lazy event (e.g. Slack channel lookup) must resolve before the provider ACK deadline. */
const PUSH_EVENT_RESOLVE_TIMEOUT_MS = 2_500;
/** Accepted-but-unprocessed push events, persisted before the provider is ACKed. */
export const PUSH_EVENT_JOURNAL_SETTING = 'trigger.pushJournal';

type PushTriggerDriver = (typeof PUSH_TRIGGER_DRIVERS)[number];

interface PushJournalEntry {
  id: string;
  triggerType: string;
  event: TriggerEvent;
  /** `started` entries left behind by a crash are not replayed: a run may have begun. */
  state: 'queued' | 'started';
  at: string;
}

function isJournalEntry(value: unknown): value is PushJournalEntry {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const entry = value as Record<string, unknown>;
  const event = entry.event as Record<string, unknown> | undefined;
  return typeof entry.id === 'string' && typeof entry.triggerType === 'string'
    && (entry.state === 'queued' || entry.state === 'started')
    && Boolean(event) && typeof event!.type === 'string'
    && Boolean(event!.payload) && typeof event!.payload === 'object';
}

async function resolvePushEvent(incoming: PushTriggerEvent): Promise<TriggerEvent | undefined> {
  if (typeof incoming !== 'function') return incoming;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      incoming(),
      new Promise<undefined>((resolve) => { timer = setTimeout(() => resolve(undefined), PUSH_EVENT_RESOLVE_TIMEOUT_MS); }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export class TriggerEventCoordinator {
  private readonly recentEvents = new Set<string>();
  private readonly inFlightEvents = new Set<string>();
  private activePushEvents = 0;
  private resolvingPushEvents = 0;
  private readonly queuedPushEvents: Array<{ driver: PushTriggerDriver; event: TriggerEvent; journalId?: string }> = [];
  /** Journal entries owned by this process (queued or running). */
  private readonly liveJournalIds = new Set<string>();
  private readonly drainWaiters = new Set<() => void>();

  constructor(
    private readonly store: WorkflowStore,
    private readonly runtime: WorkflowRuntime,
    private readonly isAcceptingEvents: () => boolean,
    private readonly onTriggeredRun?: (workflowId: string, result: unknown) => void,
  ) {}

  rememberEvent(key: string): boolean {
    if (this.recentEvents.has(key)) return false;
    this.recentEvents.add(key);
    if (this.recentEvents.size > MAX_RECENT_EVENTS) {
      const oldest = this.recentEvents.values().next().value;
      if (oldest) this.recentEvents.delete(oldest);
    }
    return true;
  }

  /**
   * Accepts a push event. Returning true lets the transport ACK the provider,
   * so the event is first persisted to the journal; it is replayed after a
   * restart if the process stops before handling it.
   */
  async handlePushEvent(
    driver: PushTriggerDriver,
    incoming: PushTriggerEvent,
  ): Promise<boolean> {
    if (!this.isAcceptingEvents()) return false;
    // Events still resolving count against capacity so a burst cannot overshoot it.
    if (
      this.activePushEvents + this.queuedPushEvents.length + this.resolvingPushEvents
      >= MAX_ACTIVE_PUSH_EVENTS + MAX_QUEUED_PUSH_EVENTS
    ) {
      console.warn('[trigger-engine] push event queue full; rejecting for provider retry');
      return false;
    }
    let event: TriggerEvent | undefined;
    if (typeof incoming === 'function') {
      this.resolvingPushEvents += 1;
      try {
        event = await resolvePushEvent(incoming);
      } catch (error) {
        console.error(`[trigger-engine] push event could not be read for ${driver.triggerType}:`, error);
        return false;
      } finally {
        this.resolvingPushEvents -= 1;
      }
    } else {
      event = incoming;
    }
    if (!event) {
      console.warn(`[trigger-engine] push event for ${driver.triggerType} timed out before ACK; rejecting for provider retry`);
      return false;
    }
    if (!this.isAcceptingEvents()) return false;
    // Not ours to run; ACK so the provider does not redeliver it forever.
    if (event.type !== driver.triggerType) return true;
    let journalId: string;
    try {
      journalId = this.appendJournal(driver.triggerType, event);
    } catch (error) {
      console.error('[trigger-engine] push event could not be persisted; rejecting for provider retry:', error);
      return false;
    }
    this.queuedPushEvents.push({ driver, event, journalId });
    this.dispatchPushEvents();
    return true;
  }

  /** Replays journaled events accepted (ACKed) by a previous process but never started. */
  replayPendingEvents(): number {
    let entries: PushJournalEntry[];
    try {
      entries = this.readJournal();
    } catch (error) {
      console.error('[trigger-engine] push event journal could not be read:', error);
      return 0;
    }
    let replayed = 0;
    for (const entry of entries) {
      if (this.liveJournalIds.has(entry.id)) continue;
      const driver = PUSH_TRIGGER_DRIVERS.find((candidate) => candidate.triggerType === entry.triggerType);
      if (entry.state === 'started' || !driver) {
        console.warn(`[trigger-engine] dropped interrupted push event ${entry.id} (${entry.triggerType}); not retried automatically`);
        this.removeJournal(entry.id);
        continue;
      }
      this.liveJournalIds.add(entry.id);
      this.queuedPushEvents.push({ driver, event: entry.event, journalId: entry.id });
      replayed += 1;
    }
    if (replayed > 0) this.dispatchPushEvents();
    return replayed;
  }

  drain(): Promise<void> {
    if (this.activePushEvents === 0 && this.queuedPushEvents.length === 0) return Promise.resolve();
    return new Promise((resolve) => this.drainWaiters.add(resolve));
  }

  private readJournal(): PushJournalEntry[] {
    const stored = this.store.getSetting<unknown>(PUSH_EVENT_JOURNAL_SETTING, []);
    return Array.isArray(stored) ? stored.filter(isJournalEntry) : [];
  }

  private appendJournal(triggerType: string, event: TriggerEvent): string {
    const id = randomUUID();
    const entry: PushJournalEntry = { id, triggerType, event, state: 'queued', at: new Date().toISOString() };
    this.store.setSetting(PUSH_EVENT_JOURNAL_SETTING, [...this.readJournal(), entry]);
    this.liveJournalIds.add(id);
    return id;
  }

  private markJournalStarted(id: string): void {
    this.store.setSetting(PUSH_EVENT_JOURNAL_SETTING, this.readJournal().map((entry) =>
      entry.id === id ? { ...entry, state: 'started' as const } : entry));
  }

  private removeJournal(id: string): void {
    this.liveJournalIds.delete(id);
    this.store.setSetting(PUSH_EVENT_JOURNAL_SETTING, this.readJournal().filter((entry) => entry.id !== id));
  }

  private dispatchPushEvents(): void {
    while (this.activePushEvents < MAX_ACTIVE_PUSH_EVENTS && this.queuedPushEvents.length > 0) {
      const next = this.queuedPushEvents.shift()!;
      this.activePushEvents += 1;
      void this.processJournaledEvent(next.driver, next.event, next.journalId)
        .catch((error) => console.error('[trigger-engine] push event processing failed:', error))
        .finally(() => {
          this.activePushEvents -= 1;
          this.dispatchPushEvents();
        });
    }
    if (this.activePushEvents === 0 && this.queuedPushEvents.length === 0) {
      for (const resolve of this.drainWaiters) resolve();
      this.drainWaiters.clear();
    }
  }

  private async processJournaledEvent(driver: PushTriggerDriver, event: TriggerEvent, journalId?: string): Promise<void> {
    if (journalId) {
      try {
        this.markJournalStarted(journalId);
      } catch (error) {
        console.error('[trigger-engine] push event journal update failed:', error);
      }
    }
    try {
      await this.processPushEvent(driver, event);
    } finally {
      if (journalId) {
        try {
          this.removeJournal(journalId);
        } catch (error) {
          console.error('[trigger-engine] push event journal cleanup failed:', error);
        }
      }
    }
  }

  private receiptCompleted(workflowId: string, event: TriggerEvent, dedupeKey: string): boolean {
    return this.store.isTriggerReceiptCompleted(dedupeKey)
      || legacyEventDedupeKeys(workflowId, event).some((key) => this.store.isTriggerReceiptCompleted(key));
  }

  /** Keep the poll fallback from rediscovering a message already delivered by push. */
  private advancePollCursor(workflowId: string, event: TriggerEvent): void {
    if (event.type !== 'slack.new_message') return;
    try {
      updateTriggerCursor(this.store, workflowId, (cursor) => cursorAfterPushedEvent(cursor, event));
    } catch (error) {
      console.error(`[trigger-engine] poll cursor update failed for skill ${workflowId}:`, error);
    }
  }

  private async processPushEvent(
    driver: PushTriggerDriver,
    event: TriggerEvent,
  ): Promise<void> {
    if (event.type !== driver.triggerType) return;
    if (!this.store.getGlobalActive()) return;

    for (const { id: workflowId, workflow: ir } of this.store.listActiveWorkflowDefinitions()) {
      const trigger = ir?.trigger;
      if (!ir || !trigger || trigger.type !== driver.triggerType) continue;
      if (!driver.matchesTrigger(trigger as { type: string; channel?: string }, event)) continue;
      if (!matchesTriggerFilter(trigger, event)) {
        this.advancePollCursor(workflowId, event);
        continue;
      }

      const dedupeKey = driver.dedupeKey(workflowId, event);
      if (this.receiptCompleted(workflowId, event, dedupeKey)) {
        this.advancePollCursor(workflowId, event);
        continue;
      }
      if (this.inFlightEvents.has(dedupeKey)) continue;
      if (
        !this.store.claimTriggerReceipt({
          dedupeKey,
          workflowId,
          triggerType: driver.triggerType,
        })
      ) {
        continue;
      }

      this.inFlightEvents.add(dedupeKey);
      try {
        await this.runClaimedEvent(workflowId, ir, trigger.type, event, dedupeKey);
      } finally {
        this.inFlightEvents.delete(dedupeKey);
      }
    }
  }

  private async runClaimedEvent(
    workflowId: string,
    ir: WorkflowIR,
    triggerType: string,
    event: TriggerEvent,
    dedupeKey: string,
  ): Promise<void> {
    let result: unknown;
    try {
      result = await this.runtime.executeWorkflow(ir, {
        triggerType,
        input: triggerInputFromEvent(event),
      });
    } catch (err) {
      console.error(`[trigger-engine] push failed for skill ${workflowId}:`, err);
      if (triggerErrorNotStarted(err)) {
        this.store.failTriggerReceipt(dedupeKey);
        return;
      }
      if (recordTriggerFailure(this.store, {
        dedupeKey, workflowId, workflow: ir, reason: err instanceof Error ? err.message : String(err),
      }) === 'dead') this.advancePollCursor(workflowId, event);
      return;
    }
    if (!triggerRunWasAccepted(result)) {
      const status = (result as Partial<ExecutionResult> | null)?.status ?? 'unknown';
      if (recordTriggerFailure(this.store, {
        dedupeKey, workflowId, workflow: ir, result: result as Partial<ExecutionResult>, reason: status,
      }) === 'dead') this.advancePollCursor(workflowId, event);
      return;
    }
    this.store.completeTriggerReceipt(dedupeKey, (result as ExecutionResult).executionId);
    clearTriggerAttempts(this.store, dedupeKey);
    this.rememberEvent(dedupeKey);
    this.advancePollCursor(workflowId, event);
    this.onTriggeredRun?.(workflowId, result);
  }
}
