import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { runCommand } from '../cli-process.js';
import { CodexCliProvider } from './adapters/codex-cli.js';
import { createAgentHarness } from '../../harness.js';

vi.mock('../cli-process.js', () => ({ resolveBinary: () => 'codex', runCommand: vi.fn() }));
afterEach(() => vi.resetAllMocks());

describe('Codex image forwarding', () => {
  const images = [
    { data: new Uint8Array([1, 2, 3]), mimeType: 'image/png', filename: '../../last.txt' },
    { data: new Uint8Array([4, 5]), mimeType: 'image/jpeg', filename: '../../last.txt' },
  ];
  it.each(['text', 'structured', 'failure', 'abort'] as const)('%s forwards ordered bytes and cleans temporary files', async (mode) => {
    let directory = '';
    const controller = new AbortController();
    vi.mocked(runCommand).mockImplementation(async (_cmd, args, options) => {
      const paths = args.flatMap((arg, i) => arg === '--image' ? [args[i + 1]!] : []);
      expect(paths).toHaveLength(2);
      expect(paths[0]).not.toBe(paths[1]);
      directory = dirname(paths[0]!);
      for (const [i, path] of paths.entries()) {
        expect(dirname(path)).toBe(directory);
        expect(new Uint8Array(await readFile(path))).toEqual(images[i]!.data);
      }
      expect(args.indexOf('--image')).toBeLessThan(args.indexOf('--'));
      if (mode === 'failure') throw new Error(mode);
      if (mode === 'abort') {
        return new Promise((_resolve, reject) => {
          options?.abortSignal?.addEventListener('abort', () => reject(new Error('abort')), { once: true });
          controller.abort();
        });
      }
      return { stdout: mode === 'text' ? 'ok' : '{"ok":true}', stderr: '', exitCode: 0 };
    });
    const provider = new CodexCliProvider('test-model');
    const request = mode === 'text'
      ? provider.generateText({ system: 'test', user: 'inspect', images })
      : createAgentHarness(provider).run({
        role: 'investigate', user: 'inspect', abortSignal: controller.signal,
        outputSchema: z.object({ ok: z.boolean() }),
        context: { skillGoal: 'g', taskGoal: 't', evidence: [], connectedConnectors: [] }, images,
      });
    if (mode === 'failure' || mode === 'abort') await expect(request).rejects.toThrow(mode);
    else await expect(request).resolves.toBeDefined();
    expect(runCommand).toHaveBeenCalledOnce();
    expect(directory).not.toBe('');
    expect(existsSync(directory)).toBe(false);
  });
  it('keeps text-only requests image-free', async () => {
    vi.mocked(runCommand).mockResolvedValue({ stdout: 'ok', stderr: '', exitCode: 0 });
    await new CodexCliProvider('test').generateText({ system: 's', user: 'u' });
    expect(vi.mocked(runCommand).mock.calls[0]![1]).not.toContain('--image');
  });
  it('rejects unsupported image formats before launching CLI', async () => {
    await expect(new CodexCliProvider('test').generateText({
      system: 's', user: 'inspect', images: [{ data: new Uint8Array([1]), mimeType: 'text/html' }],
    })).rejects.toMatchObject({ code: 'image_format_unsupported' });
    expect(runCommand).not.toHaveBeenCalled();
  });
});
