import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const cliProcess = vi.hoisted(() => ({
  resolveBinary: vi.fn(),
  runCommand: vi.fn(),
}));

vi.mock('../model/cli-process.js', () => cliProcess);

import { detectAiCliProviders } from './cli-detect.js';
import { CLI_PROVIDER_META } from './catalog.js';

describe('AI CLI detection', () => {
  beforeEach(() => {
    vi.stubEnv('CURSOR_API_KEY', '');
    cliProcess.resolveBinary.mockImplementation((binaries: readonly string[]) => binaries[0]);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it('checks installed providers concurrently and preserves catalog order', async () => {
    let activeCommands = 0;
    let maxConcurrentCommands = 0;
    cliProcess.runCommand.mockImplementation(async () => {
      activeCommands += 1;
      maxConcurrentCommands = Math.max(maxConcurrentCommands, activeCommands);
      await new Promise((resolve) => setTimeout(resolve, 10));
      activeCommands -= 1;
      return { stdout: 'v1', stderr: '', exitCode: 0 };
    });

    const detected = await detectAiCliProviders();

    expect(maxConcurrentCommands).toBe(4);
    expect(detected.map(({ id }) => id)).toEqual(['codex-cli', 'claude-cli', 'cursor-cli']);
  });

  it('keeps other providers available when a probe fails', async () => {
    cliProcess.runCommand.mockImplementation(async (_command: string, args: string[]) => {
      if (_command === 'claude' && args[0] === '--version') throw new Error('probe failed');
      return { stdout: args[0] === 'debug' ? '' : `${_command} v1`, stderr: '', exitCode: 0 };
    });

    const detected = await detectAiCliProviders();

    expect(detected.find(({ id }) => id === 'claude-cli')).toMatchObject({
      installed: true,
      description: CLI_PROVIDER_META['claude-cli'].description,
      version: undefined,
    });
    expect(detected.find(({ id }) => id === 'codex-cli')?.models).toEqual(
      CLI_PROVIDER_META['codex-cli'].models,
    );
  });
});
