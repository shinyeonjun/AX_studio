import type { WorkflowStore } from '../store/workflow-store.js';
import type { WorkflowRuntime } from './engine.js';
import { getTriggerHandler } from '../triggers/registry.js';
import { PUSH_TRIGGER_DRIVERS } from '../modules/packages/catalog.js';
import {
  TRIGGER_CURSOR_SETTING_KEY,
  type TriggerCursorStore,
  type TriggerEvent,
} from '../triggers/types.js';

const TIME_TRIGGER_TYPES = new Set(['manual', 'once', 'schedule']);
const MAX_RECENT_EVENTS = 2000;

interface ActivePushTransport {
  stop(): Promise<void>;
  isRunning(): boolean;
}

function triggerInputFromEvent(event: TriggerEvent): Record<string, unknown> {
  const { body: _body, ...payload } = event.payload;
  return {
    ...payload,
    sender: event.payload.sender ?? event.payload.from ?? event.payload.user,
  };
}

export class TriggerEngine {
  private timers: Map<string, ReturnType<typeof setInterval>> = new Map();
  private tickMs = 30_000;
  private ticking = false;
  private pushTransports = new Map<string, ActivePushTransport>();
  private recentEvents = new Set<string>();

  constructor(
    private store: WorkflowStore,
    private runtime: WorkflowRuntime,
    private onTriggeredRun?: (workflowId: string, result: unknown) => void,
  ) {}

  start() {
    if (!this.timers.has('main')) {
      const interval = setInterval(() => {
        void this.tick();
      }, this.tickMs);
      this.timers.set('main', interval);
      void this.tick();
    }
    void this.refreshPushTransports();
  }

  stop() {
    for (const timer of this.timers.values()) clearInterval(timer);
    this.timers.clear();
    void this.refreshPushTransports(null);
  }

  pushTransportActive(triggerType: string): boolean {
    return this.pushTransports.get(triggerType)?.isRunning() ?? false;
  }

  slackSocketActive(): boolean {
    return this.pushTransportActive('slack.new_message');
  }

  async refreshPushTransports(disconnect?: null): Promise<void> {
    for (const transport of this.pushTransports.values()) {
      await transport.stop();
    }
    this.pushTransports.clear();

    if (disconnect === null) return;

    for (const driver of PUSH_TRIGGER_DRIVERS) {
      const transport = await driver.refresh(this.store, (event) => {
        void this.handlePushEvent(driver, event);
      });
      if (transport) {
        this.pushTransports.set(driver.triggerType, transport);
      }
    }
  }

  /** Backward-compatible entry point used by desktop Slack settings. */
  async refreshSlackSocket(config?: { token: string; appToken?: string } | null): Promise<void> {
    if (config === null) {
      await this.refreshPushTransports(null);
      return;
    }
    await this.refreshPushTransports();
  }

  private rememberEvent(key: string): boolean {
    if (this.recentEvents.has(key)) return false;
    this.recentEvents.add(key);
    if (this.recentEvents.size > MAX_RECENT_EVENTS) {
      const oldest = this.recentEvents.values().next().value;
      if (oldest) this.recentEvents.delete(oldest);
    }
    return true;
  }

  private async handlePushEvent(
    driver: (typeof PUSH_TRIGGER_DRIVERS)[number],
    event: TriggerEvent,
  ) {
    if (event.type !== driver.triggerType) return;
    if (!this.store.getSetting<boolean>('globalActive', true)) return;

    for (const skill of this.store.listWorkflows()) {
      if (!skill.active) continue;

      const ir = this.store.getWorkflow(skill.id);
      const trigger = ir?.trigger;
      if (!ir || !trigger || trigger.type !== driver.triggerType) continue;
      if (!driver.matchesTrigger(trigger as { type: string; channel?: string }, event)) continue;

      const dedupeKey = driver.dedupeKey(skill.id, event);
      if (!this.rememberEvent(dedupeKey)) continue;

      try {
        const result = await this.runtime.executeWorkflow(ir, {
          triggerType: trigger.type,
          input: triggerInputFromEvent(event),
        });
        this.onTriggeredRun?.(skill.id, result);
      } catch (err) {
        console.error(`[trigger-engine] push failed for skill ${skill.id}:`, err);
      }
    }
  }

  private loadCursors(): TriggerCursorStore {
    return this.store.getSetting<TriggerCursorStore>(TRIGGER_CURSOR_SETTING_KEY, {});
  }

  private saveCursors(cursors: TriggerCursorStore) {
    this.store.setSetting(TRIGGER_CURSOR_SETTING_KEY, cursors);
  }

  private shouldPollTriggerType(triggerType: string): boolean {
    const driver = PUSH_TRIGGER_DRIVERS.find((entry) => entry.triggerType === triggerType);
    if (driver?.skipPollWhenActive && this.pushTransportActive(triggerType)) {
      return false;
    }
    const handler = getTriggerHandler(triggerType);
    if (!handler) return false;
    if (handler.transport === 'push' && !driver?.skipPollWhenActive) {
      return false;
    }
    return typeof handler.poll === 'function';
  }

  async tick() {
    if (this.ticking) return;
    this.ticking = true;

    try {
      const globalActive = this.store.getSetting<boolean>('globalActive', true);
      if (!globalActive) return;

      const cursors = this.loadCursors();
      let cursorsChanged = false;

      for (const skill of this.store.listWorkflows()) {
        if (!skill.active) continue;

        const ir = this.store.getWorkflow(skill.id);
        const trigger = ir?.trigger;
        if (!ir || !trigger || TIME_TRIGGER_TYPES.has(trigger.type)) continue;
        if (!this.shouldPollTriggerType(trigger.type)) continue;

        const handler = getTriggerHandler(trigger.type);
        if (!handler?.poll) continue;

        const cursor = cursors[skill.id] ?? {};

        try {
          const pollResult = await handler.poll({
            workflowId: skill.id,
            trigger,
            cursor,
            connectors: this.runtime.connectors,
          });

          if (JSON.stringify(pollResult.cursor) !== JSON.stringify(cursor)) {
            cursors[skill.id] = pollResult.cursor;
            cursorsChanged = true;
          }

          for (const event of pollResult.events) {
            const result = await this.runtime.executeWorkflow(ir, {
              triggerType: trigger.type,
              input: triggerInputFromEvent(event),
            });
            this.onTriggeredRun?.(skill.id, result);
          }
        } catch (err) {
          console.error(`[trigger-engine] poll failed for skill ${skill.id}:`, err);
        }
      }

      if (cursorsChanged) {
        this.saveCursors(cursors);
      }
    } finally {
      this.ticking = false;
    }
  }
}
