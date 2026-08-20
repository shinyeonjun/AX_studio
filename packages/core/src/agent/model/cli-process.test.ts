import { describe, expect, it } from 'vitest';
import { runCommand } from './cli-process.js';

describe('runCommand', () => {
  it('closes stdin when no input is provided', async () => {
    const result = await runCommand(
      process.execPath,
      ['-e', "process.stdin.resume(); process.stdin.on('end', () => process.stdout.write('done'));"],
      { timeoutMs: 2_000 },
    );

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('done');
  });
});
