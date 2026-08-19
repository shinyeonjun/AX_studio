import { describe, it, expect } from 'vitest';
import { parseSkillIR } from './skill/schema.js';
import { validateApprovalPolicy } from './skill/approval.js';
import { csMailSkillFixture } from './skill/fixtures.js';
import { createDatabase } from './store/db.js';
import { SkillStore } from './store/skill-store.js';
import packageJson from '../package.json';

describe('core package boundary', () => {
  it('has no electron or react in dependencies', () => {
    const deps = { ...packageJson.dependencies, ...packageJson.devDependencies };
    expect(deps.electron).toBeUndefined();
    expect(deps.react).toBeUndefined();
  });

  it('gmail.send fixture invalid without approval step removed', () => {
    const bad = {
      ...csMailSkillFixture,
      steps: csMailSkillFixture.steps.filter((s) => s.type !== 'human_approval'),
    };
    expect(validateApprovalPolicy(bad).length).toBeGreaterThan(0);
  });

  it('store roundtrip', () => {
    const store = new SkillStore(createDatabase(':memory:'));
    const { skillId } = store.saveSkill(parseSkillIR(csMailSkillFixture));
    expect(store.getSkill(skillId)?.name).toBe('고객 문의 처리');
  });
});
