import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildInvestigatePrompt, setAgentSkillsDir } from './index.js';
import type { AxJobProposeArgs } from './index.js';

describe('Agent public API', () => {
  it('uses the configured skill directory when building a prompt', () => {
    const root = mkdtempSync(join(tmpdir(), 'ax-agent-skills-'));
    const commandDir = join(root, 'investigate');
    mkdirSync(commandDir, { recursive: true });
    writeFileSync(
      join(commandDir, 'SKILL.md'),
      [
        '---',
        'name: custom-investigate',
        'description: test investigation',
        '---',
        'CUSTOM SKILL {{task_goal}} {{task_memo}}',
        '',
      ].join('\n'),
      'utf8',
    );

    try {
      setAgentSkillsDir(root);
      const prompt = buildInvestigatePrompt('investigate', {
        skillGoal: 'check', taskGoal: 'find the cause', taskMemo: 'memo', evidence: [],
      } as never);

      expect(prompt).toContain('CUSTOM SKILL');
      expect(prompt).toContain('find the cause');
      expect(prompt).toContain('memo');
    } finally {
      setAgentSkillsDir(undefined);
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('exposes the job proposal contract through the Agent entrypoint', () => {
    const args: AxJobProposeArgs = {
      name: 'Daily Dev Brief',
      goal: '전날 변경사항을 요약한다',
      schedule: { cron: '0 21 * * *', timezone: 'Asia/Seoul' },
      fetch: { method: 'GET', path: '/commits', connectionId: 'default' },
      interpret: { goal: '변경사항을 짧게 요약한다' },
      notify: { connector: 'slack', channel: '#updates', skipIfEmpty: true },
      runOnceNow: true,
      allowExternalAuto: true,
    };

    expect(args.name).toBe('Daily Dev Brief');
  });
});
