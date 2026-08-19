import type { SkillStore } from '../store/skill-store.js';
import type { SkillRuntime } from './engine.js';
import { getTriggerHandler } from '../triggers/registry.js';
import {
  TRIGGER_CURSOR_SETTING_KEY,
  type TriggerCursorStore,
  type TriggerEvent,
} from '../triggers/types.js';

const TIME_TRIGGER_TYPES = new Set(['manual', 'once', 'schedule']);

function triggerInputFromEvent(event: TriggerEvent): Record<string, unknown> {
  return {
    ...event.payload,
    sender: event.payload.sender ?? event.payload.from,
    emailBody: event.payload.body ?? event.payload.snippet,
  };
}

export class TriggerEngine {
  private timers: Map<string, ReturnType<typeof setInterval>> = new Map();
  private tickMs = 30_000;
  private ticking = false;

  constructor(
    private store: SkillStore,
    private runtime: SkillRuntime,
    private onTriggeredRun?: (skillId: string, result: unknown) => void,
  ) {}

  start() {
    if (this.timers.has('main')) return;
    const interval = setInterval(() => {
      void this.tick();
    }, this.tickMs);
    this.timers.set('main', interval);
  }

  stop() {
    for (const timer of this.timers.values()) clearInterval(timer);
    this.timers.clear();
  }

  private loadCursors(): TriggerCursorStore {
    return this.store.getSetting<TriggerCursorStore>(TRIGGER_CURSOR_SETTING_KEY, {});
  }

  private saveCursors(cursors: TriggerCursorStore) {
    this.store.setSetting(TRIGGER_CURSOR_SETTING_KEY, cursors);
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

        const handler = getTriggerHandler(trigger.type);
        if (!handler) continue;

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
