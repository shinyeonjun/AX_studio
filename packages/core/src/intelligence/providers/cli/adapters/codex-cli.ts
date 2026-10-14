import { readFile, writeFile } from 'node:fs/promises';
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
import { cliFailureMessage, parseStructuredFromCliResult } from '../output.js';
import { supportedCliFlags } from '../capabilities.js';

const FAILURE_MESSAGE = 'Codex CLI 호출에 실패했습니다.';

/** Features that give the agent tools beyond producing an answer; unknown keys are ignored. */
const DISABLED_CODEX_FEATURES = [
  'shell_tool', 'apps', 'plugins', 'hooks', 'browser_use', 'browser_use_external',
  'computer_use', 'in_app_browser', 'image_generation', 'skill_mcp_dependency_install',
] as const;

export interface CodexExecOptions {
  workDir?: string;
  reasoningEffort?: 'low' | 'medium' | 'high';
  /** Skips `$CODEX_HOME/config.toml` (MCP servers, profiles) while keeping its auth. */
  ignoreUserConfig?: boolean;
  /** Replaces Codex's own coding-agent instructions; older CLIs ignore the unknown key. */
  instructionsPath?: string;
}

/**
 * Codex otherwise prepends its coding-agent base instructions to every call: measured on
 * codex-cli 0.159, a one-word prompt cost 13,604 input tokens with them and 10,060 with this.
 * AX Studio's own prompt already carries the rules; this only states the call's shape.
 */
const CODEX_BASE_INSTRUCTIONS = [
  'You are the language model behind AX Studio, called once for a single request.',
  'Follow the instructions in the prompt exactly. You have no tools: do not run commands, read files or browse.',
  'Answer in the language and format the prompt asks for. When an output schema is given, return only JSON that matches it.',
].join('\n');

/**
 * Codex CLI 0.147+ removed --ask-for-approval. Prompts carry untrusted mail/document text,
 * so runs are read-only, ephemeral and tool-less.
 */
export function codexExecArgs(model: string, extras: string[] = [], options: CodexExecOptions = {}): string[] {
  return [
    'exec',
    '--json',
    '--skip-git-repo-check',
    ...(options.workDir ? ['-C', options.workDir] : []),
    ...(options.ignoreUserConfig ? ['--ignore-user-config'] : []),
    '-s',
    'read-only',
    '--ephemeral',
    '--color',
    'never',
    '-c',
    `model_reasoning_effort=${options.reasoningEffort ?? 'high'}`,
    // A TOML string; forward slashes keep a Windows path free of escapes.
    ...(options.instructionsPath
      ? ['-c', `model_instructions_file=${JSON.stringify(options.instructionsPath.replace(/\\/g, '/'))}`]
      : []),
    ...DISABLED_CODEX_FEATURES.flatMap((feature) => ['-c', `features.${feature}=false`]),
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

async function codexCommand(): Promise<{ command: string; ignoreUserConfig: boolean }> {
  const command = await requiredBinary('codex-cli');
  const supported = await supportedCliFlags(command, ['exec', '--help'], ['--ignore-user-config']);
  return { command, ignoreUserConfig: supported.has('--ignore-user-config') };
}

/**
 * What `codex exec --json` said went wrong ({"type":"error"} or {"type":"turn.failed"} on stdout).
 * Without it a failed turn surfaced only as "Codex CLI 호출에 실패했습니다".
 */
export function codexEventError(line: string): string | undefined {
  let parsed: unknown;
  try { parsed = JSON.parse(line); } catch { return undefined; }
  if (!parsed || typeof parsed !== 'object') return undefined;
  const event = parsed as { type?: unknown; message?: unknown; error?: { message?: unknown } };
  if (event.type === 'error' && typeof event.message === 'string') return event.message;
  if (event.type === 'turn.failed' && typeof event.error?.message === 'string') return event.error.message;
  return undefined;
}

/** The generic failure, made specific by Codex's own error when it gave one. */
function withEventError(failure: string | null, eventError: string | undefined): string | null {
  return failure === FAILURE_MESSAGE && eventError ? `${FAILURE_MESSAGE} (${eventError.slice(0, 300)})` : failure;
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

/** Writes the short base instructions into the run's own directory and returns the path. */
async function writeBaseInstructions(dir: string): Promise<string> {
  const path = join(dir, 'instructions.md');
  await writeFile(path, CODEX_BASE_INSTRUCTIONS, 'utf8');
  return path;
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
    const { command, ignoreUserConfig } = await codexCommand();
    const prompt = composedPrompt(input);
    return withTempDir(async (dir) => {
      const outPath = join(dir, 'last.txt');
      let eventError: string | undefined;
      const result = await runCommand(
        command,
        codexExecArgs(this.model, [...await imageArgs(dir, input.images), '-o', outPath], {
          workDir: dir, reasoningEffort: input.codexReasoningEffort, ignoreUserConfig,
          instructionsPath: await writeBaseInstructions(dir),
        }),
        {
          input: prompt,
          timeoutMs: input.timeoutMs ?? 180_000,
          abortSignal: input.abortSignal,
          cwd: dir,
          captureStdout: false,
          onStdoutLine: line => { reportCodexUsage(line, input); eventError = codexEventError(line) ?? eventError; },
        },
      );
      const failure = withEventError(cliFailureMessage(result, FAILURE_MESSAGE), eventError);
      if (failure) throw new Error(failure);
      const text = (await readFile(outPath, 'utf8').catch(() => '')).trim() || result.stdout.trim();
      // stderr carries progress and diagnostics, never the answer.
      if (!text) throw new Error(FAILURE_MESSAGE);
      return text;
    });
  }

  async generateStructured<T>(input: StructuredGenerateInput<T>): Promise<T> {
    const { command, ignoreUserConfig } = await codexCommand();
    const prompt = composedPrompt(input);
    const schema = zodToCodexJsonSchema(input.schema);
    const reasoningEffort = input.codexReasoningEffort ?? 'high';
    const raw = await withTempDir(async (dir) => {
      const schemaPath = join(dir, 'schema.json');
      const outPath = join(dir, 'last.txt');
      await writeFile(schemaPath, JSON.stringify(schema), 'utf8');
      let eventError: string | undefined;
      const result = await runCommand(
        command,
        codexExecArgs(this.model, [
          ...await imageArgs(dir, input.images),
          '--output-schema',
          schemaPath,
          '-o',
          outPath,
        ], { workDir: dir, reasoningEffort, ignoreUserConfig, instructionsPath: await writeBaseInstructions(dir) }),
        {
          input: prompt,
          timeoutMs: input.timeoutMs ?? 180_000,
          abortSignal: input.abortSignal,
          cwd: dir,
          captureStdout: false,
          onStdoutLine: line => { reportCodexUsage(line, input); eventError = codexEventError(line) ?? eventError; },
        },
      );
      if (result.exitCode !== 0 && eventError) throw new Error(withEventError(FAILURE_MESSAGE, eventError)!);
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
    return parseStructuredFromCliResult(raw, responseSchema, FAILURE_MESSAGE, true);
  }
}
