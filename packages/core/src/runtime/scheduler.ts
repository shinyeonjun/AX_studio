import type { SkillStore } from '../store/skill-store.js';
import type { SkillIR } from '../skill/schema.js';
import type { SkillRuntime } from '../runtime/engine.js';

export interface ScheduledJob {
  skillId: string;
  schedule: string;
  timezone: string;
  nextRunAt?: string;
}

export class Scheduler {
  private timers: Map<string, ReturnType<typeof setInterval>> = new Map();
  private tickMs = 30_000;

  constructor(
    private store: SkillStore,
    private runtime: SkillRuntime,
    private onScheduledRun?: (skillId: string, result: unknown) => void,
  ) {}

  start() {
    const interval = setInterval(() => this.tick(), this.tickMs);
    this.timers.set('main', interval);
  }

  stop() {
    for (const t of this.timers.values()) clearInterval(t);
    this.timers.clear();
  }

  private async tick() {
    const globalActive = this.store.getSetting<boolean>('globalActive', true);
    if (!globalActive) return;

    const skills = this.store.listSkills();
    for (const s of skills) {
      if (!s.active) continue;
      const ir = this.store.getSkill(s.id);
      if (!ir?.trigger || ir.trigger.type !== 'schedule') continue;
      const result = await this.runtime.executeSkill(ir, { triggerType: 'schedule' });
      this.onScheduledRun?.(s.id, result);
    }
  }

  async runSkillNow(skillId: string): Promise<unknown> {
    const ir = this.store.getSkill(skillId);
    if (!ir) throw new Error('Skill not found');
    return this.runtime.executeSkill(ir, { triggerType: 'manual' });
  }

  persistSkillFromEphemeral(ir: SkillIR, trigger?: SkillIR['trigger']): string {
    const withTrigger = { ...ir, trigger: trigger ?? ir.trigger };
    const { skillId } = this.store.saveSkill(withTrigger as SkillIR);
    return skillId;
  }
}
