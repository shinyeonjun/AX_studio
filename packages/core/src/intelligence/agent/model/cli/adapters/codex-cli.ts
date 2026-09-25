import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { decodeCodexOutput } from '../../cli-json/schema/decode-codex.js';
import {
  reportModelTokenUsage,
  type ModelImageInput,
  type ModelProvider,
  type StructuredGenerateInput,
  type TextGenerateInput,
} from '../../provider.js';
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
    '--json',
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

function reportCodexUsage(line: string, input: Pick<TextGenerateInput, 'onUsage'>): void {
  let parsed: unknown;
  try { parsed = JSON.parse(line); } catch { return; }
  if (!parsed || typeof parsed !== 'object') return;
  const event = parsed as { type?: unknown; usage?: unknown };
  if (event.type !== 'turn.completed' || !event.usage || typeof event.usage !== 'object') return;
  const usage = event.usage as Record<string, unknown>;
  const count = (value: unknown) => typeof value === 'number' ? value : undefined;
  reportModelTokenUsage(input, {
    inputTokens: count(usage.input_tokens),
    outputTokens: count(usage.output_tokens),
    cachedInputTokens: count(usage.cached_input_tokens),
    cacheWriteInputTokens: count(usage.cache_write_input_tokens),
    reasoningTokens: count(usage.reasoning_output_tokens),
  });
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
        {
          input: prompt,
          timeoutMs: input.timeoutMs ?? 180_000,
          abortSignal: input.abortSignal,
          cwd: dir,
          captureStdout: false,
          onStdoutLine: line => reportCodexUsage(line, input),
        },
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
        {
          input: prompt,
          timeoutMs: input.timeoutMs ?? 180_000,
          abortSignal: input.abortSignal,
          cwd: dir,
          captureStdout: false,
          onStdoutLine: line => reportCodexUsage(line, input),
        },
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
    const debugRawDir = process.env.AX_REPORT_DEBUG_RAW_DIR;
    if (debugRawDir) {
      await mkdir(debugRawDir, { recursive: true });
      await writeFile(join(debugRawDir, `${Date.now()}-${input.logContext ?? 'structured'}.json`), JSON.stringify(raw), 'utf8');
    }
    const responseSchema = z.preprocess(
      (value) => decodeCodexOutput(value, input.schema), input.schema,
    ) as typeof input.schema;
    return parseStructuredFromCliResult(raw, responseSchema, 'Codex CLI 호출에 실패했습니다.', true);
  }
}
