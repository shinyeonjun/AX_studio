import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  cliFailureMessage,
  parseStructuredFromCliResult,
  pickCliOutput,
  readableCliError,
} from './cli/output.js';

describe('cli output handling', () => {
  it('falls back when stderr is blank and bounds long diagnostics', () => {
    expect(readableCliError(' \n ', 'fail')).toBe('fail');
    expect(readableCliError('x'.repeat(5_000), 'fail').length).toBeLessThanOrEqual(2_049);
  });

  it('never treats stderr as model output', () => {
    expect(pickCliOutput({ stdout: '{"ok":true}' })).toBe('{"ok":true}');
    expect(pickCliOutput({ stdout: '  ' })).toBe('');
  });

  it('surfaces non-zero exit stdout error without json parse noise', () => {
    const message = cliFailureMessage(
      {
        exitCode: 1,
        stdout: 'Error: Sandbox mode is enabled but not available',
        stderr: '',
      },
      'fail',
    );
    expect(message).toBe('Error: Sandbox mode is enabled but not available');
  });

  it('does not attach Codex progress stderr to a schema validation error', async () => {
    await expect(
      parseStructuredFromCliResult(
        {
          exitCode: 0,
          stdout: '{"ok":false}',
          stderr: 'Reading additional input from stdin...\nOpenAI Codex v0.147.0',
        },
        z.object({ ok: z.literal(true) }),
        'fail',
      ),
    ).rejects.toThrow(/\(\[\s*[\s\S]*Invalid literal value/);
  });
});
