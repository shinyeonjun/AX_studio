import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildCommandProtocolPrompt, setAgentSkillsDir } from './index.js';
import type { AxJobProposeArgs } from './index.js';

describe('Agent public API', () => {
  it('uses the configured skill directory when building a command prompt', () => {
    const root = mkdtempSync(join(tmpdir(), 'ax-agent-skills-'));
    const commandDir = join(root, 'command');
    mkdirSync(commandDir, { recursive: true });
    writeFileSync(
      join(commandDir, 'SKILL.md'),
      [
        '---',
        'name: custom-command',
        'description: test command protocol',
        '---',
        'CUSTOM COMMAND {{command_contracts}} {{output_instructions}}',
        '',
      ].join('\n'),
      'utf8',
    );

    try {
      setAgentSkillsDir(root);
      const prompt = buildCommandProtocolPrompt({
        commands: [{ name: 'workflow.list' }],
        outputInstructions: 'reply or command',
      });

      expect(prompt).toContain('CUSTOM COMMAND');
      expect(prompt).toContain('workflow.list');
      expect(prompt).toContain('reply or command');
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
