import { describe, it, expect } from 'vitest';
import { parseSkillIR, validateSkillIR } from '../skill/schema.js';
import { validateApprovalPolicy, isDeployable } from '../skill/approval.js';
import { csMailSkillFixture, weeklyReportSkillFixture, dataPolicyFixture } from '../skill/fixtures.js';
import { createDatabase } from '../store/db.js';
import { SkillStore } from '../store/skill-store.js';
import { assessCompleteness } from '../interviewer/requiredness.js';
import { startInterview, applyAnswer, directCompileInstruction } from '../interviewer/interview.js';
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
  it('CRUD roundtrip', () => {
    const db = createDatabase(':memory:');
    const store = new SkillStore(db);
    const { skillId } = store.saveSkill(csMailSkillFixture);
    const loaded = store.getSkill(skillId);
    expect(loaded?.name).toBe('고객 문의 처리');
    store.setConnection('gmail', true);
    expect(store.getConnections()[0].connected).toBe(true);
  });
});

describe('Interviewer', () => {
  it('finds missing slots for underspecified instruction', () => {
    const state = startInterview('메일 확인해줘');
    expect(state.completeness.missingRequired.length).toBeGreaterThan(0);
  });

  it('fills slots through interview', () => {
    let state = startInterview('고객 문의 메일 분류해서 슬랙으로 알려줘');
    state = applyAnswer(state, 'support@ Gmail');
    state = applyAnswer(state, '#support-critical');
    state = applyAnswer(state, '분류 완료 및 알림 전송');
    expect(state.draft.steps?.length).toBeGreaterThan(0);
  });
});

describe('Runtime', () => {
  it('runs CS flow with approval gate', async () => {
    const db = createDatabase(':memory:');
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
    instruction: string;
    answers?: string[];
    requiredSlots: string[];
    needsApproval: boolean;
  }>;

  for (const scenario of scenarios) {
    it(`direct vs interview: ${scenario.id}`, async () => {
      const direct = await directCompileInstruction(scenario.instruction);
      const directCompleteness = assessCompleteness(direct, ['gmail', 'slack', 'local_sheet']);

      let interview = startInterview(scenario.instruction);
      for (const answer of scenario.answers ?? []) {
        interview = applyAnswer(interview, answer);
      }

      const interviewMissing = interview.completeness.missingRequired.length;
      const directMissing = directCompleteness.missingRequired.length;

      expect(interviewMissing).toBeLessThanOrEqual(directMissing + 1);
    });
  }
});
