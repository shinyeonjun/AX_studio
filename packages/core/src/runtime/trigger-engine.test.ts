import { describe, expect, it } from 'vitest';
import { createDatabaseAsync } from '../store/db.js';
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
    const db = await createDatabaseAsync(':memory:');
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
    const db = await createDatabaseAsync(':memory:');
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

  it('baselines slack trigger and fires once for each new channel message', async () => {
    const slackNotifySkill: SkillIR = {
      name: 'Slack 알림',
      goal: 'Slack 새 메시지 시 알림 채널로 전달',
      version: 1,
      trigger: { type: 'slack.new_message', channel: '#general' },
      inputs: ['text', 'user', 'channel'],
      steps: [
        {
          type: 'action',
          id: 'notify',
          connector: 'slack',
          action: 'message.send',
          params: { channel: '#alerts', text: 'new slack message' },
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

    const db = await createDatabaseAsync(':memory:');
    const store = new SkillStore(db);
    const runtime = new SkillRuntime({ store, globalActive: true, skillActive: {} });
    runtime.mockSlack.inbound.push({
      channel: '#general',
      text: '기존 메시지',
      ts: '100.000',
      user: 'U_OLD',
    });

    const { skillId } = store.saveSkill(slackNotifySkill);
    store.setSkillActive(skillId, true);
    const engine = new TriggerEngine(store, runtime);

    await engine.tick();
    expect(runtime.mockSlack.messages).toHaveLength(0);

    runtime.mockSlack.inbound.push({
      channel: '#general',
      text: '새 메시지',
      ts: '101.000',
      user: 'U_NEW',
    });

    await engine.tick();
    expect(runtime.mockSlack.messages).toHaveLength(1);
    expect(runtime.mockSlack.messages[0]?.channel).toBe('#alerts');

    await engine.tick();
    expect(runtime.mockSlack.messages).toHaveLength(1);
  });
});
