import type { WorkflowStore } from '../../store/workflow-store.js';
import type { WorkflowRuntime } from '../engine.js';
import { PUSH_TRIGGER_DRIVERS } from '../../modules/packages/catalog.js';
import type { TriggerEvent } from '../../triggers/types.js';
import { matchesTriggerFilter } from '../../triggers/filter.js';
import type { ExecutionResult } from '../types.js';
import {
  MAX_RECENT_EVENTS,
  eventDedupeKey,
  triggerInputFromEvent,
  triggerRunWasAccepted,
} from './helpers.js';

type PushTriggerDriver = (typeof PUSH_TRIGGER_DRIVERS)[number];

export class TriggerEventCoordinator {
  private readonly recentEvents = new Set<string>();
  private readonly inFlightEvents = new Set<string>();

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
    event: TriggerEvent,
  ): Promise<void> {
    if (!this.isAcceptingEvents()) return;
    if (event.type !== driver.triggerType) return;
    if (!this.store.getGlobalActive()) return;

    for (const skill of this.store.listWorkflows()) {
      if (!skill.active) continue;

      const ir = this.store.getWorkflow(skill.id);
      const trigger = ir?.trigger;
      if (!ir || !trigger || trigger.type !== driver.triggerType) continue;
      if (!driver.matchesTrigger(trigger as { type: string; channel?: string }, event)) continue;
      if (!matchesTriggerFilter(trigger, event)) continue;

      const dedupeKey = driver.dedupeKey(skill.id, event);
      if (this.store.isTriggerReceiptCompleted(dedupeKey)) continue;
      if (this.inFlightEvents.has(dedupeKey)) continue;
      if (
        !this.store.claimTriggerReceipt({
          dedupeKey,
          workflowId: skill.id,
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
        this.onTriggeredRun?.(skill.id, result);
      } catch (err) {
        this.store.failTriggerReceipt(dedupeKey);
        console.error(`[trigger-engine] push failed for skill ${skill.id}:`, err);
      } finally {
        this.inFlightEvents.delete(dedupeKey);
      }
    }
  }
}
