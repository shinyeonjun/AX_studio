import { describe, expect, it } from 'vitest';
import { codexEventError, codexExecArgs } from './adapters/codex-cli.js';
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

  it('replaces the coding-agent base instructions with a short file when given one', () => {
    const args = codexExecArgs('gpt-5.4', [], { instructionsPath: 'C:\\Temp\\ax-cli-1\\instructions.md' });
    expect(args).toContain('model_instructions_file="C:/Temp/ax-cli-1/instructions.md"');
    expect(args.indexOf('model_instructions_file="C:/Temp/ax-cli-1/instructions.md"')).toBeLessThan(args.indexOf('--'));
    expect(codexExecArgs('gpt-5.4').some((arg) => arg.startsWith('model_instructions_file'))).toBe(false);
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

  it('keeps the reason a codex turn failed, from its --json events', () => {
    // Real: in the Jev vs Codex comparison, 11 requests to gpt-6.1-sol failed with this, shown only as the generic failure.
    expect(codexEventError('{"type":"error","message":"Selected model is at capacity. Please try a different model."}'))
      .toBe('Selected model is at capacity. Please try a different model.');
    expect(codexEventError('{"type":"turn.failed","error":{"message":"stream disconnected"}}')).toBe('stream disconnected');
    expect(codexEventError('{"type":"turn.completed","usage":{}}')).toBeUndefined();
    expect(codexEventError('not json')).toBeUndefined();
  });
});
