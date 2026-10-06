import { existsSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { runCommand } from '../cli-process.js';
import { supportedCliFlags } from './capabilities.js';
import { ClaudeCliProvider } from './adapters/claude-cli.js';

vi.mock('../cli-process.js', () => ({ resolveBinaryAsync: async () => 'claude', runCommand: vi.fn() }));
vi.mock('./capabilities.js', () => ({ supportedCliFlags: vi.fn() }));
afterEach(() => vi.resetAllMocks());

const ALL_FLAGS = ['--tools', '--setting-sources', '--strict-mcp-config', '--no-session-persistence', '--disable-slash-commands'];

describe('Claude CLI isolation', () => {
  it('runs without tools, MCP, settings or session persistence in an owned temp cwd', async () => {
    vi.mocked(supportedCliFlags).mockResolvedValue(new Set(ALL_FLAGS));
    let cwd = '';
    vi.mocked(runCommand).mockImplementation(async (_command, _args, options) => {
      cwd = options?.cwd ?? '';
      expect(existsSync(cwd)).toBe(true);
      return { stdout: 'answer', stderr: '', exitCode: 0 };
    });
    await expect(new ClaudeCliProvider('sonnet').generateText({ system: 's', user: 'u' })).resolves.toBe('answer');
    const args = vi.mocked(runCommand).mock.calls[0]![1];
    expect(args).toEqual(expect.arrayContaining(['--strict-mcp-config', '--no-session-persistence', '--disable-slash-commands']));
    expect(args[args.indexOf('--tools') + 1]).toBe('');
    expect(args[args.indexOf('--setting-sources') + 1]).toBe('');
    expect(cwd).not.toBe(process.cwd());
    expect(existsSync(cwd)).toBe(false);
  });

  it('falls back to denying tools on CLI builds without --tools', async () => {
    vi.mocked(supportedCliFlags).mockResolvedValue(new Set());
    vi.mocked(runCommand).mockResolvedValue({ stdout: 'answer', stderr: '', exitCode: 0 });
    await new ClaudeCliProvider('sonnet').generateText({ system: 's', user: 'u' });
    const args = vi.mocked(runCommand).mock.calls[0]![1];
    expect(args).toContain('--disallowedTools');
    expect(args).not.toContain('--tools');
  });

  it('never returns stdout from a failed run and bounds the stderr it reports', async () => {
    vi.mocked(supportedCliFlags).mockResolvedValue(new Set(ALL_FLAGS));
    vi.mocked(runCommand).mockResolvedValue({ stdout: 'partial answer', stderr: 'x'.repeat(10_000), exitCode: 1 });
    const error: Error = await new ClaudeCliProvider('sonnet').generateText({ system: 's', user: 'u' })
      .then(() => new Error('expected failure'), (e: Error) => e);
    expect(error).toBeInstanceOf(Error);
    expect(error.message).not.toContain('partial answer');
    expect(error.message.length).toBeLessThanOrEqual(2_049);
  });
});
