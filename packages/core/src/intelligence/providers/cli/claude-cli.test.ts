import { existsSync, readFileSync } from 'node:fs';
import { z } from 'zod';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { runCommand } from '../cli-process.js';
import { supportedCliFlags } from './capabilities.js';
import { ClaudeCliProvider } from './adapters/claude-cli.js';

vi.mock('../cli-process.js', () => ({ resolveBinaryAsync: async () => 'claude', runCommand: vi.fn() }));
vi.mock('./capabilities.js', () => ({ supportedCliFlags: vi.fn() }));
afterEach(() => vi.resetAllMocks());

/** What `claude -p --output-format stream-json` prints: events, the last one the result. */
const streamOut = (result: Record<string, unknown>) => [
  JSON.stringify({ type: 'system', subtype: 'init' }),
  JSON.stringify({ type: 'assistant', message: { content: [] } }),
  JSON.stringify({ type: 'result', is_error: false, ...result }),
].join('\n');

const ALL_FLAGS = ['--tools', '--setting-sources', '--strict-mcp-config', '--no-session-persistence', '--disable-slash-commands'];

describe('Claude CLI isolation', () => {
  it('runs without tools, MCP, settings or session persistence in an owned temp cwd', async () => {
    vi.mocked(supportedCliFlags).mockResolvedValue(new Set(ALL_FLAGS));
    let cwd = '';
    vi.mocked(runCommand).mockImplementation(async (_command, _args, options) => {
      cwd = options?.cwd ?? '';
      expect(existsSync(cwd)).toBe(true);
      return { stdout: streamOut({ result: 'answer' }), stderr: '', exitCode: 0 };
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
    vi.mocked(runCommand).mockResolvedValue({ stdout: streamOut({ result: 'answer' }), stderr: '', exitCode: 0 });
    await new ClaudeCliProvider('sonnet').generateText({ system: 's', user: 'u' });
    const args = vi.mocked(runCommand).mock.calls[0]![1];
    expect(args).toContain('--disallowedTools');
    expect(args).not.toContain('--tools');
  });

  it('sends the system prompt as a file and the turn as stream-json, and reads reply and tokens from the result event', async () => {
    vi.mocked(supportedCliFlags).mockResolvedValue(new Set(ALL_FLAGS));
    let systemFile = '';
    let turn = '';
    vi.mocked(runCommand).mockImplementation(async (_command, args, options) => {
      systemFile = readFileSync(args[args.indexOf('--system-prompt-file') + 1]!, 'utf8');
      turn = options?.input ?? '';
      return { stdout: streamOut({ result: '안녕', usage: { input_tokens: 2, cache_creation_input_tokens: 100, cache_read_input_tokens: 7, output_tokens: 5, output_tokens_details: { thinking_tokens: 1 } } }), stderr: '', exitCode: 0 };
    });
    const usage: unknown[] = [];
    const provider = new ClaudeCliProvider('sonnet');
    await expect(provider.generateText({ system: 'SYSTEM RULES', user: '질문', onUsage: (u) => usage.push(u) })).resolves.toBe('안녕');
    const args = vi.mocked(runCommand).mock.calls[0]![1];
    expect(args[args.indexOf('--input-format') + 1]).toBe('stream-json');
    expect(args[args.indexOf('--output-format') + 1]).toBe('stream-json');
    expect(systemFile).toBe('SYSTEM RULES');
    const message = JSON.parse(turn) as { type: string; message: { content: Array<{ type: string; text?: string }> } };
    expect(message.type).toBe('user');
    expect(message.message.content).toEqual([{ type: 'text', text: 'User: 질문' }]);
    expect(turn).not.toContain('SYSTEM RULES');
    expect(usage).toEqual([{ inputTokens: 2, outputTokens: 5, cachedInputTokens: 7, cacheWriteInputTokens: 100, reasoningTokens: 1 }]);
    expect(provider.usageInputExcludesCache).toBe(true);
    vi.mocked(runCommand).mockResolvedValue({ stdout: streamOut({ result: 'x', is_error: true }), stderr: '', exitCode: 0 });
    await expect(provider.generateText({ system: 's', user: 'u' })).rejects.toThrow();
  });

  it('puts images in the turn as base64 blocks and returns the structured output', async () => {
    vi.mocked(supportedCliFlags).mockResolvedValue(new Set(ALL_FLAGS));
    vi.mocked(runCommand).mockResolvedValue({ stdout: streamOut({ result: '{"color":"red"}', structured_output: { color: 'red' } }), stderr: '', exitCode: 0 });
    const provider = new ClaudeCliProvider('sonnet');
    expect(provider.supportsVision).toBe(true);
    const output = await provider.generateStructured({
      system: 's', user: '무슨 색?', schema: z.object({ color: z.string() }),
      images: [{ mimeType: 'image/png', data: new Uint8Array([1, 2, 3]) }],
    });
    expect(output).toEqual({ color: 'red' });
    const turn = JSON.parse(vi.mocked(runCommand).mock.calls[0]![2]!.input!) as { message: { content: Array<Record<string, unknown>> } };
    expect(turn.message.content[0]).toEqual({ type: 'image', source: { type: 'base64', media_type: 'image/png', data: Buffer.from([1, 2, 3]).toString('base64') } });
    await expect(provider.generateText({ system: 's', user: 'u', images: [{ mimeType: 'image/bmp', data: new Uint8Array([1]) }] }))
      .rejects.toMatchObject({ code: 'image_format_unsupported' });
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
