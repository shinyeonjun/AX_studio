import { describe, expect, it } from 'vitest';
import { codexExecArgs } from './adapters/codex-cli.js';
import { cliFailureMessage } from './output.js';

describe('codex cli adapter', () => {
  it('uses current codex exec flags', () => {
    const args = codexExecArgs('gpt-5.4', ['-o', '/tmp/out.txt'], { workDir: '/tmp/ax-cli', ignoreUserConfig: true });
    expect(args).toContain('--json');
    expect(args).toContain('-s');
    expect(args).toContain('read-only');
    expect(args).toContain('-C');
    expect(args).toContain('/tmp/ax-cli');
    expect(args).toContain('-c');
    expect(args).toContain('model_reasoning_effort=high');
    expect(args).not.toContain('--ask-for-approval');
    expect(args.at(-1)).toBe('-');
  });

  it('disables agent tools and user config for untrusted prompts', () => {
    const args = codexExecArgs('gpt-5.4', [], { ignoreUserConfig: true });
    expect(args).toContain('--ignore-user-config');
    expect(args).toContain('--ephemeral');
    for (const feature of ['shell_tool', 'plugins', 'apps', 'hooks', 'computer_use']) {
      expect(args).toContain(`features.${feature}=false`);
    }
    expect(codexExecArgs('gpt-5.4')).not.toContain('--ignore-user-config');
  });

  it('extracts quoted message from truncated codex ERROR json', () => {
    const message = cliFailureMessage(
      {
        exitCode: 1,
        stdout: '',
        stderr: 'ERROR: {\n  "error": { "message": "schema is not valid" }',
      },
      'fallback',
    );
    expect(message).toBe('schema is not valid');
  });

  it('does not surface a lone brace as the CLI error', () => {
    const message = cliFailureMessage(
      {
        exitCode: 1,
        stdout: '',
        stderr: 'ERROR: {',
      },
      'Codex CLI 호출에 실패했습니다.',
    );
    expect(message).toBe('Codex CLI 호출에 실패했습니다.');
  });
});
