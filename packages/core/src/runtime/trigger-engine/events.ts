import type { WorkflowStore } from '../../persistence/workflow-store.js';
import type { WorkflowRuntime } from '../engine.js';
import { PUSH_TRIGGER_DRIVERS } from '../../connectors/packages/catalog.js';
import type { PushTriggerEvent } from '../../connectors/module-package.js';
import { matchesTriggerFilter } from '../../triggers/filter.js';
import type { ExecutionResult } from '../types.js';
import {
  MAX_RECENT_EVENTS,
  triggerInputFromEvent,
  triggerRunWasAccepted,
} from './helpers.js';

const MAX_ACTIVE_PUSH_EVENTS = 16;
const MAX_QUEUED_PUSH_EVENTS = 128;

type PushTriggerDriver = (typeof PUSH_TRIGGER_DRIVERS)[number];

export class TriggerEventCoordinator {
  private readonly recentEvents = new Set<string>();
  private readonly inFlightEvents = new Set<string>();
  private activePushEvents = 0;
  private readonly queuedPushEvents: Array<{ driver: PushTriggerDriver; event: PushTriggerEvent }> = [];
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

  async handlePushEvent(
    driver: PushTriggerDriver,
    event: PushTriggerEvent,
  ): Promise<boolean> {
    if (!this.isAcceptingEvents()) return false;
    if (
      this.activePushEvents >= MAX_ACTIVE_PUSH_EVENTS
      && this.queuedPushEvents.length >= MAX_QUEUED_PUSH_EVENTS
    ) {
      console.warn('[trigger-engine] push event queue full; rejecting for provider retry');
      return false;
    }
    this.queuedPushEvents.push({ driver, event });
    this.dispatchPushEvents();
    return true;
  }

  drain(): Promise<void> {
    if (this.activePushEvents === 0 && this.queuedPushEvents.length === 0) return Promise.resolve();
    return new Promise((resolve) => this.drainWaiters.add(resolve));
  }

  private dispatchPushEvents(): void {
    while (this.activePushEvents < MAX_ACTIVE_PUSH_EVENTS && this.queuedPushEvents.length > 0) {
      const next = this.queuedPushEvents.shift()!;
      this.activePushEvents += 1;
      void this.processPushEvent(next.driver, next.event)
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

  private async processPushEvent(
    driver: PushTriggerDriver,
    incomingEvent: PushTriggerEvent,
  ): Promise<void> {
    const event = typeof incomingEvent === 'function' ? await incomingEvent() : incomingEvent;
    if (event.type !== driver.triggerType) return;
    if (!this.store.getGlobalActive()) return;

    for (const { id: workflowId, workflow: ir } of this.store.listActiveWorkflowDefinitions()) {
      const trigger = ir?.trigger;
      if (!ir || !trigger || trigger.type !== driver.triggerType) continue;
      if (!driver.matchesTrigger(trigger as { type: string; channel?: string }, event)) continue;
      if (!matchesTriggerFilter(trigger, event)) continue;

      const dedupeKey = driver.dedupeKey(workflowId, event);
      if (this.store.isTriggerReceiptCompleted(dedupeKey)) continue;
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
        const result = await this.runtime.executeWorkflow(ir, {
          triggerType: trigger.type,
          input: triggerInputFromEvent(event),
        });
        if (!triggerRunWasAccepted(result)) {
          this.store.failTriggerReceipt(dedupeKey);
          continue;
        }
        this.store.completeTriggerReceipt(dedupeKey, (result as ExecutionResult).executionId);
        this.rememberEvent(dedupeKey);
        this.onTriggeredRun?.(workflowId, result);
      } catch (err) {
        this.store.failTriggerReceipt(dedupeKey);
        console.error(`[trigger-engine] push failed for skill ${workflowId}:`, err);
      } finally {
        this.inFlightEvents.delete(dedupeKey);
      }
    }
  }
}
