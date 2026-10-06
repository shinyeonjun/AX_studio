import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EMBEDDED_AGENT_SKILLS } from './embedded.js';
import { AGENT_SKILL_DEV_OVERRIDES_ENV, loadAgentSkill, setAgentSkillsDir } from './skill-load.js';

describe('agent skill loading', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    setAgentSkillsDir(undefined);
  });

  it('ignores env skill directories unless the dev opt-in is set', () => {
    const root = mkdtempSync(join(tmpdir(), 'ax-skill-env-'));
    try {
      mkdirSync(join(root, 'command'), { recursive: true });
      writeFileSync(join(root, 'command', 'SKILL.md'), 'INJECTED', 'utf8');
      vi.stubEnv('AX_SKILLS_DIR', root);
      setAgentSkillsDir(undefined);
      expect(loadAgentSkill('command').raw).toBe(EMBEDDED_AGENT_SKILLS.command);

      vi.stubEnv(AGENT_SKILL_DEV_OVERRIDES_ENV, '1');
      setAgentSkillsDir(undefined);
      expect(loadAgentSkill('command').raw).toBe('INJECTED');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
