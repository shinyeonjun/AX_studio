import { describe, expect, it } from 'vitest';
import { createDatabase } from '../store/db.js';
import { SkillStore } from '../store/skill-store.js';
import { SkillRuntime } from './engine.js';
import { TriggerEngine } from './trigger-engine.js';
import type { SkillIR } from '../skill/schema.js';

const gmailNotifySkill: SkillIR = {
  name: '새 메일 알림',
  goal: '새 Gmail 도착 시 Slack 알림',
  version: 1,
  trigger: { type: 'gmail.new_message', accountId: 'primary' },
  inputs: ['from', 'subject', 'body'],
  steps: [
    {
      type: 'action',
      id: 'notify',
      connector: 'slack',
      action: 'message.send',
      params: { channel: '#inbox', text: 'new mail' },
      sideEffect: 'EXTERNAL',
    },
  ],
  permissions: {},
  approval: [],
  allowExternalAuto: true,
  assumptions: [],
  sideEffects: {},
  dataPolicy: {},
};

describe('TriggerEngine', () => {
  it('baselines on first poll and fires once for each new gmail message', async () => {
    const db = createDatabase(':memory:');
    const store = new SkillStore(db);
    const runtime = new SkillRuntime({ store, globalActive: true, skillActive: {} });
    runtime.mockGmail.messages.push({
      id: 'msg-existing',
      from: 'old@example.com',
      subject: '기존 메일',
      body: 'already here',
    });

    const { skillId } = store.saveSkill(gmailNotifySkill);
    store.setSkillActive(skillId, true);

    const engine = new TriggerEngine(store, runtime);

    await engine.tick();
    expect(runtime.mockSlack.messages).toHaveLength(0);

    runtime.mockGmail.messages.push({
      id: 'msg-new',
      from: 'plosind@naver.com',
      subject: '새 문의',
      body: '내용',
    });

    await engine.tick();
    expect(runtime.mockSlack.messages).toHaveLength(1);
    expect(runtime.mockSlack.messages[0]?.channel).toBe('#inbox');

    await engine.tick();
    expect(runtime.mockSlack.messages).toHaveLength(1);
  });

  it('does not poll inactive skills', async () => {
    const db = createDatabase(':memory:');
    const store = new SkillStore(db);
    const runtime = new SkillRuntime({ store, globalActive: true, skillActive: {} });
    const { skillId } = store.saveSkill(gmailNotifySkill);
    store.setSkillActive(skillId, false);

    const engine = new TriggerEngine(store, runtime);
    await engine.tick();

    runtime.mockGmail.messages.push({
      id: 'msg-new',
      from: 'a@b.com',
      subject: 'test',
      body: 'body',
    });
    await engine.tick();
    expect(runtime.mockSlack.messages).toHaveLength(0);
  });
});
