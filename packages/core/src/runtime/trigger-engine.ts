import type { WorkflowStore } from '../store/workflow-store.js';
import type { WorkflowRuntime } from './engine.js';
import { getTriggerHandler } from '../triggers/registry.js';
import { PUSH_TRIGGER_DRIVERS } from '../modules/packages/catalog.js';
import {
  TRIGGER_CURSOR_SETTING_KEY,
  type TriggerCursorStore,
  type TriggerCursor,
  type TriggerEvent,
} from '../triggers/types.js';
import { matchesTriggerFilter } from '../triggers/filter.js';
import type { ExecutionResult } from './types.js';

const TIME_TRIGGER_TYPES = new Set(['manual', 'once', 'schedule']);
const MAX_RECENT_EVENTS = 2000;

interface ActivePushTransport {
  stop(): Promise<void>;
  isRunning(): boolean;
}

function triggerInputFromEvent(event: TriggerEvent): Record<string, unknown> {
  const { body: bodyField, ...payload } = event.payload;
  const input: Record<string, unknown> = {
    ...payload,
    sender: event.payload.sender ?? event.payload.from ?? event.payload.user,
  };
  if (event.type === 'webhook.inbound' && typeof bodyField === 'string') {
    input.body = bodyField;
  }
  return input;
}

function triggerRunWasAccepted(result: unknown): boolean {
  const status = (result as Partial<ExecutionResult> | null)?.status;
  return status === 'success' || status === 'pending_approval';
}

function eventDedupeKey(workflowId: string, event: TriggerEvent): string | undefined {
  const payload = event.payload;
  const eventId = [payload.messageId, payload.filePath, payload.ts].find(
    (value): value is string => typeof value === 'string' && value.length > 0,
  );
  return eventId ? `${workflowId}:${event.type}:${eventId}` : undefined;
}

function cursorAfterEvent(
  cursor: TriggerCursor,
  event: TriggerEvent,
): TriggerCursor {
  const next = { ...cursor };
  const payload = event.payload;

  if (typeof payload.messageId === 'string') {
    const seen = new Set(cursor.seenMessageIds ?? []);
    seen.add(payload.messageId);
    next.seenMessageIds = [...seen].slice(-500);
  }
  if (typeof payload.filePath === 'string') {
    const seen = new Set(cursor.seenFileKeys ?? []);
    seen.add(payload.filePath);
    next.seenFileKeys = [...seen].slice(-5_000);
  }
  if (typeof payload.ts === 'string') {
    next.lastMessageTs = payload.ts;
  }

  return next;
}

export class TriggerEngine {
  private timers: Map<string, ReturnType<typeof setInterval>> = new Map();
  private tickMs = 30_000;
  private ticking = false;
  private lifecycleGeneration = 0;
  private acceptingEvents = false;
  private pushTransports = new Map<string, ActivePushTransport>();
  private recentEvents = new Set<string>();
  private pushRefreshGeneration = 0;
  private pushRefreshQueue: Promise<void> = Promise.resolve();

  constructor(
    private store: WorkflowStore,
    private runtime: WorkflowRuntime,
    private onTriggeredRun?: (workflowId: string, result: unknown) => void,
  ) {}

  start() {
    if (!this.timers.has('main')) {
      this.lifecycleGeneration += 1;
      this.acceptingEvents = true;
      const interval = setInterval(() => {
        void this.tick();
      }, this.tickMs);
      this.timers.set('main', interval);
      void this.tick();
    }
    void this.refreshPushTransports();
  }

  async stop(): Promise<void> {
    this.lifecycleGeneration += 1;
    this.acceptingEvents = false;
    for (const timer of this.timers.values()) clearInterval(timer);
    this.timers.clear();
    await this.refreshPushTransports(null);
  }

  pushTransportActive(triggerType: string): boolean {
    return this.pushTransports.get(triggerType)?.isRunning() ?? false;
  }

  slackSocketActive(): boolean {
    return this.pushTransportActive('slack.new_message');
  }

  async refreshPushTransports(disconnect?: null): Promise<void> {
    const generation = ++this.pushRefreshGeneration;
    const refresh = async () => {
      for (const transport of this.pushTransports.values()) {
        await transport.stop();
      }
      this.pushTransports.clear();

      if (disconnect === null || generation !== this.pushRefreshGeneration) return;

      for (const driver of PUSH_TRIGGER_DRIVERS) {
        const transport = await driver.refresh(this.store, (event) => {
          void this.handlePushEvent(driver, event);
        });
        if (!transport) continue;

        if (generation !== this.pushRefreshGeneration) {
          await transport.stop();
          return;
        }
        this.pushTransports.set(driver.triggerType, transport);
      }
    };

    this.pushRefreshQueue = this.pushRefreshQueue.then(refresh, refresh);
    await this.pushRefreshQueue;
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
    if (!this.acceptingEvents) return;
    if (event.type !== driver.triggerType) return;
    if (!this.store.getSetting<boolean>('globalActive', true)) return;

    for (const skill of this.store.listWorkflows()) {
      if (!skill.active) continue;

      const ir = this.store.getWorkflow(skill.id);
      const trigger = ir?.trigger;
      if (!ir || !trigger || trigger.type !== driver.triggerType) continue;
      if (!driver.matchesTrigger(trigger as { type: string; channel?: string }, event)) continue;
      if (!matchesTriggerFilter(trigger, event)) continue;

      const dedupeKey = driver.dedupeKey(skill.id, event);
      if (this.recentEvents.has(dedupeKey)) continue;

      try {
        const result = await this.runtime.executeWorkflow(ir, {
          triggerType: trigger.type,
          input: triggerInputFromEvent(event),
        });
        if (!triggerRunWasAccepted(result)) continue;
        this.rememberEvent(dedupeKey);
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
    const generation = this.lifecycleGeneration;

    try {
      const globalActive = this.store.getSetting<boolean>('globalActive', true);
      if (!globalActive) return;

      const cursors = this.loadCursors();
      let cursorsChanged = false;

      for (const skill of this.store.listWorkflows()) {
        if (generation !== this.lifecycleGeneration) return;
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
          if (generation !== this.lifecycleGeneration) return;

          let processedCursor: TriggerCursor = {
            ...cursor,
            initialized: pollResult.cursor.initialized ?? cursor.initialized,
            folderId: pollResult.cursor.folderId ?? cursor.folderId,
            channelId: pollResult.cursor.channelId ?? cursor.channelId,
          };
          for (const event of pollResult.events) {
            if (generation !== this.lifecycleGeneration) return;
            const dedupeKey = eventDedupeKey(skill.id, event);
            if (dedupeKey && this.recentEvents.has(dedupeKey)) {
              // The in-memory key means this event was already accepted in this process.
              // Persist its cursor progress as well, so a later event failure cannot make
              // the already-accepted event appear unprocessed on the next poll.
              processedCursor = cursorAfterEvent(processedCursor, event);
              cursors[skill.id] = processedCursor;
              this.saveCursors(cursors);
              cursorsChanged = false;
              continue;
            }

            if (!matchesTriggerFilter(trigger, event)) {
              processedCursor = cursorAfterEvent(processedCursor, event);
              if (dedupeKey) this.rememberEvent(dedupeKey);
              cursors[skill.id] = processedCursor;
              this.saveCursors(cursors);
              cursorsChanged = false;
              continue;
            }
            const result = await this.runtime.executeWorkflow(ir, {
              triggerType: trigger.type,
              input: triggerInputFromEvent(event),
            });
            if (generation !== this.lifecycleGeneration) return;
            if (!triggerRunWasAccepted(result)) {
              throw new Error(`trigger execution was not accepted: ${(result as Partial<ExecutionResult>).status ?? 'unknown'}`);
            }
            processedCursor = cursorAfterEvent(processedCursor, event);
            if (dedupeKey) this.rememberEvent(dedupeKey);
            cursors[skill.id] = processedCursor;
            this.saveCursors(cursors);
            cursorsChanged = false;
            this.onTriggeredRun?.(skill.id, result);
          }

          if (JSON.stringify(pollResult.cursor) !== JSON.stringify(processedCursor)) {
            cursors[skill.id] = pollResult.cursor;
            cursorsChanged = true;
          }
        } catch (err) {
          console.error(`[trigger-engine] poll failed for skill ${skill.id}:`, err);
        }
      }

      if (cursorsChanged && generation === this.lifecycleGeneration) {
        this.saveCursors(cursors);
      }
    } finally {
      this.ticking = false;
    }
  }
}
