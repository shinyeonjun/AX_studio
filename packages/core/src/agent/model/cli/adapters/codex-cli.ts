import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { decodeCodexOutput } from '../../cli-json/schema/decode-codex.js';
import type { ModelImageInput, ModelProvider, StructuredGenerateInput, TextGenerateInput } from '../../provider.js';
import { zodToCodexJsonSchema } from '../../cli-json.js';
import { runCommand } from '../../cli-process.js';
import { composedPrompt, requiredBinary, withTempDir } from '../shared.js';
import { parseStructuredFromCliResult } from '../output.js';

/** Codex CLI 0.147+ removed --ask-for-approval; clamp reasoning effort for structured exec. */
export function codexExecArgs(
  model: string,
  _prompt: string,
  extras: string[] = [],
  workDir?: string,
  reasoningEffort: 'low' | 'medium' | 'high' = 'high',
): string[] {
  return [
    'exec',
    '--skip-git-repo-check',
    ...(workDir ? ['-C', workDir] : []),
    '-s',
    'read-only',
    '--ephemeral',
    '--color',
    'never',
    '-c',
    `model_reasoning_effort=${reasoningEffort}`,
    '-m',
    model,
    ...extras,
    '--',
    // Codex reads the initial prompt from stdin when the positional prompt is "-".
    // Keeping the full prompt out of argv is required on Windows, where CreateProcess
    // rejects large command lines with ENAMETOOLONG.
    '-',
  ];
}

async function imageArgs(dir: string, images: ModelImageInput[] = []): Promise<string[]> {
  const extensions = new Map([
    ['image/png', 'png'], ['image/jpeg', 'jpg'], ['image/webp', 'webp'], ['image/gif', 'gif'],
  ]);
  const args: string[] = [];
  for (const [index, image] of images.entries()) {
    const extension = extensions.get(image.mimeType);
    if (!extension) {
      throw Object.assign(new Error('Unsupported image format'), { code: 'image_format_unsupported' });
    }
    if (!image.data.byteLength) {
      throw Object.assign(new Error('Empty image input'), { code: 'image_input_empty' });
    }
    // Never use caller filenames: every attachment stays inside the owned directory.
    const path = join(dir, `image-${index + 1}.${extension}`);
    await writeFile(path, image.data);
    args.push('--image', path);
  }
  return args;
}

export class CodexCliProvider implements ModelProvider {
  readonly name = 'codex-cli';
  readonly supportsVision = true;

  constructor(readonly model: string) {}

  async generateText(input: TextGenerateInput): Promise<string> {
    const command = requiredBinary('codex-cli');
    const prompt = composedPrompt(input);
    return withTempDir(async (dir) => {
      const outPath = join(dir, 'last.txt');
      const result = await runCommand(
        command,
        codexExecArgs(this.model, prompt, [...await imageArgs(dir, input.images), '-o', outPath], dir),
        { input: prompt, timeoutMs: input.timeoutMs ?? 180_000, abortSignal: input.abortSignal, cwd: dir },
      );
      try {
        return (await readFile(outPath, 'utf8')).trim();
      } catch {
        if (result.exitCode !== 0) {
          throw new Error(result.stderr.trim() || 'Codex CLI 호출에 실패했습니다.');
        }
        return result.stdout.trim() || result.stderr.trim();
      }
    });
  }

  async generateStructured<T>(input: StructuredGenerateInput<T>): Promise<T> {
    const command = requiredBinary('codex-cli');
    const prompt = composedPrompt(input);
    const schema = zodToCodexJsonSchema(input.schema);
    const reasoningEffort = input.codexReasoningEffort ?? 'high';
    const raw = await withTempDir(async (dir) => {
      const schemaPath = join(dir, 'schema.json');
      const outPath = join(dir, 'last.txt');
      await writeFile(schemaPath, JSON.stringify(schema), 'utf8');
      const result = await runCommand(
        command,
        codexExecArgs(this.model, prompt, [
          ...await imageArgs(dir, input.images),
          '--output-schema',
          schemaPath,
          '-o',
          outPath,
        ], dir, reasoningEffort),
        { input: prompt, timeoutMs: input.timeoutMs ?? 180_000, abortSignal: input.abortSignal, cwd: dir },
      );
      try {
        return {
          stdout: await readFile(outPath, 'utf8'),
          stderr: result.stderr,
          exitCode: result.exitCode,
        };
      } catch {
        return result;
      }
    });
    const responseSchema = z.preprocess(
      (value) => decodeCodexOutput(value, input.schema), input.schema,
    ) as typeof input.schema;
    return parseStructuredFromCliResult(raw, responseSchema, 'Codex CLI 호출에 실패했습니다.', true);
  }
}
