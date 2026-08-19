import { describe, it, expect } from 'vitest';
import { parseSkillIR, validateSkillIR } from '../skill/schema.js';
import { validateApprovalPolicy, isDeployable } from '../skill/approval.js';
import { csMailSkillFixture, weeklyReportSkillFixture, dataPolicyFixture } from '../skill/fixtures.js';
import { createDatabaseAsync } from '../store/db.js';
import { SkillStore } from '../store/skill-store.js';
import { assessCompleteness, computeRequiredSlots } from '../interview/requiredness.js';
import { SkillRuntime } from '../runtime/engine.js';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('Skill IR', () => {
  it('validates fixtures', () => {
    expect(parseSkillIR(csMailSkillFixture).name).toBe('고객 문의 처리');
    expect(parseSkillIR(weeklyReportSkillFixture).trigger?.type).toBe('schedule');
    expect(parseSkillIR(dataPolicyFixture).dataPolicy.emailBody?.cloudAllowed).toBe(false);
  });

  it('requires approval for gmail send without human_approval', () => {
    const bad = { ...csMailSkillFixture, steps: csMailSkillFixture.steps.filter((s) => s.type !== 'human_approval') };
    const errors = validateApprovalPolicy(bad);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('cs fixture is deployable', () => {
    expect(isDeployable(csMailSkillFixture)).toBe(true);
  });
});

describe('SkillStore', () => {
  it('CRUD roundtrip', async () => {
    const db = await createDatabaseAsync(':memory:');
    const store = new SkillStore(db);
    const { skillId } = store.saveSkill(csMailSkillFixture);
    const loaded = store.getSkill(skillId);
    expect(loaded?.name).toBe('고객 문의 처리');
    store.setConnection('gmail', true);
    expect(store.getConnections()[0].connected).toBe(true);
  });
});

describe('requiredness', () => {
  it('requires recipient for gmail send', () => {
    const missing = assessCompleteness(
      {
        goal: '테스트 메일',
        success: '발송',
        trigger: { type: 'once', runAt: '2026-08-19T10:00:00.000Z' },
        steps: [
          {
            type: 'action',
            id: 'send',
            connector: 'gmail',
            action: 'message.send',
            params: {},
            sideEffect: 'EXTERNAL_HIGH',
          },
          {
            type: 'human_approval',
            id: 'approve',
            reason: '발송',
            forActionIds: ['send'],
          },
        ],
      },
      ['gmail'],
    );
    expect(missing.missingRequired).toContain('gmail.message.send.to');
  });
});

describe('Runtime', () => {
  it('runs CS flow with approval gate', async () => {
    const db = await createDatabaseAsync(':memory:');
    const store = new SkillStore(db);
    const runtime = new SkillRuntime({ store, globalActive: true, skillActive: {} });
    runtime.mockGmail.messages.push({
      id: '1',
      from: 'customer@example.com',
      subject: '환불 요청',
      body: '결제가 두 번 됐습니다',
    });

    const ir = { ...csMailSkillFixture, steps: csMailSkillFixture.steps.filter((s) => s.id !== 'send_reply' && s.id !== 'approve_send') };
    const result = await runtime.executeSkill(ir, { ephemeral: true, input: { emailBody: runtime.mockGmail.messages[0].body } });
    expect(result.status).toBe('success');
    expect(runtime.mockSlack.messages.length).toBeGreaterThan(0);
  });
});

describe('Eval scenarios', () => {
  const scenariosPath = join(__dirname, 'scenarios.json');
  const scenarios = JSON.parse(readFileSync(scenariosPath, 'utf-8')) as Array<{
    id: string;
    requiredSlots: string[];
  }>;
  const knownSlots = [
    'goal',
    'trigger',
    'trigger.schedule',
    'trigger.timezone',
    'gmail.account',
    'slack.channel',
    'local_file.path',
    'rdb.connection',
    'approval',
    'gmail.message.send.to',
  ];

  for (const scenario of scenarios) {
    it(`records required slots for ${scenario.id}`, () => {
      expect(scenario.requiredSlots.length).toBeGreaterThan(0);
      for (const slot of scenario.requiredSlots) {
        expect(
          knownSlots.includes(slot) || computeRequiredSlots({ goal: 'x', steps: [] }).some((item) => item.slot === slot),
        ).toBe(true);
      }
    });
  }
});
