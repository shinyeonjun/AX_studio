import type { SkillStore } from '../store/skill-store.js';
import type { SkillRuntime } from './engine.js';
import { getTriggerHandler } from '../triggers/registry.js';
import { slackChannelMatches } from '../triggers/slack-new-message/channel-match.js';
import { SlackSocketModeListener } from '../triggers/slack-new-message/socket-mode.js';
import {
  TRIGGER_CURSOR_SETTING_KEY,
  parseSlackConnectionConfig,
  type TriggerCursorStore,
  type TriggerEvent,
} from '../triggers/types.js';

const TIME_TRIGGER_TYPES = new Set(['manual', 'once', 'schedule']);
const PUSH_POLL_FALLBACK = new Set(['slack.new_message']);
const MAX_RECENT_EVENTS = 2000;

function triggerInputFromEvent(event: TriggerEvent): Record<string, unknown> {
  return {
    ...event.payload,
    sender: event.payload.sender ?? event.payload.from ?? event.payload.user,
    emailBody: event.payload.body ?? event.payload.snippet ?? event.payload.text,
  };
}

export class TriggerEngine {
  private timers: Map<string, ReturnType<typeof setInterval>> = new Map();
  private tickMs = 30_000;
  private ticking = false;
  private slackSocket?: SlackSocketModeListener;
  private recentEvents = new Set<string>();

  constructor(
    private store: SkillStore,
    private runtime: SkillRuntime,
    private onTriggeredRun?: (skillId: string, result: unknown) => void,
  ) {}

  start() {
    if (!this.timers.has('main')) {
      const interval = setInterval(() => {
        void this.tick();
      }, this.tickMs);
      this.timers.set('main', interval);
      void this.tick();
    }
    void this.refreshSlackSocket();
  }

  stop() {
    for (const timer of this.timers.values()) clearInterval(timer);
    this.timers.clear();
    void this.refreshSlackSocket(null);
  }

  slackSocketActive(): boolean {
    return this.slackSocket?.isRunning() ?? false;
  }

  async refreshSlackSocket(config?: { token: string; appToken?: string } | null): Promise<void> {
    await this.slackSocket?.stop();
    this.slackSocket = undefined;

    if (config === null) return;

    const slackConfig =
      config === undefined
        ? parseSlackConnectionConfig(
            this.store.getConnections().find((entry) => entry.connector === 'slack')?.config,
          )
        : config;

    if (!slackConfig?.token || !slackConfig.appToken) return;

    const listener = new SlackSocketModeListener();
    await listener.start(slackConfig.token, slackConfig.appToken, (event) => {
      void this.handlePushEvent(event);
    });
    this.slackSocket = listener;
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

  private async handlePushEvent(event: TriggerEvent) {
    if (event.type !== 'slack.new_message') return;
    if (!this.store.getSetting<boolean>('globalActive', true)) return;

    const channel = String(event.payload.channel ?? '');
    const channelId = String(event.payload.channelId ?? '');

    for (const skill of this.store.listSkills()) {
      if (!skill.active) continue;

      const ir = this.store.getSkill(skill.id);
      const trigger = ir?.trigger;
      if (!ir || trigger?.type !== 'slack.new_message') continue;
      if (!slackChannelMatches(trigger.channel, { channel, channelId })) continue;

      const dedupeKey = `${skill.id}:${String(event.payload.ts ?? event.payload.messageId ?? '')}`;
      if (!this.rememberEvent(dedupeKey)) continue;

      try {
        const result = await this.runtime.executeSkill(ir, {
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
    if (PUSH_POLL_FALLBACK.has(triggerType) && this.slackSocketActive()) {
      return false;
    }
    const handler = getTriggerHandler(triggerType);
    if (!handler) return false;
    if (handler.transport === 'push' && !PUSH_POLL_FALLBACK.has(triggerType)) {
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

      for (const skill of this.store.listSkills()) {
        if (!skill.active) continue;

        const ir = this.store.getSkill(skill.id);
        const trigger = ir?.trigger;
        if (!ir || !trigger || TIME_TRIGGER_TYPES.has(trigger.type)) continue;
        if (!this.shouldPollTriggerType(trigger.type)) continue;

        const handler = getTriggerHandler(trigger.type);
        if (!handler?.poll) continue;

        const cursor = cursors[skill.id] ?? {};

        try {
          const pollResult = await handler.poll({
            skillId: skill.id,
            trigger,
            cursor,
            connectors: this.runtime.connectors,
          });

          if (JSON.stringify(pollResult.cursor) !== JSON.stringify(cursor)) {
            cursors[skill.id] = pollResult.cursor;
            cursorsChanged = true;
          }

          for (const event of pollResult.events) {
            const result = await this.runtime.executeSkill(ir, {
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
