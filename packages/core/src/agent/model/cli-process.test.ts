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

  it('passes large input through stdin instead of the process argument list', async () => {
    const result = await runCommand(
      process.execPath,
      [
        '-e',
        "let size=0; process.stdin.on('data', chunk => size += chunk.length); process.stdin.on('end', () => process.stdout.write(String(size)));",
      ],
      { input: 'x'.repeat(400_000), timeoutMs: 2_000 },
    );

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('400000');
  });

  it('bounds streaming CLI output', async () => {
    await expect(
      runCommand(
        process.execPath,
        ['-e', "process.stdout.write('x'.repeat(9 * 1024 * 1024));"],
        { timeoutMs: 2_000, onStdoutLine: () => {} },
      ),
    ).rejects.toMatchObject({ code: 'EOUTPUTTOOLARGE' });
  });

  it('rejects oversized argv before spawning a child process', async () => {
    await expect(
      runCommand(process.execPath, ['-e', `process.stdout.write(${JSON.stringify('x'.repeat(40_000))})`], {
        timeoutMs: 2_000,
      }),
    ).rejects.toMatchObject({ code: 'EARGTOOLARGE' });
  });
});
