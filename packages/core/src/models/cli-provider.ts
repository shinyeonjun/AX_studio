import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ZodType } from 'zod';
import { chatMessagesFromInput, flattenChatPrompt } from './chat.js';
import type { ModelProvider, StructuredGenerateInput, TextGenerateInput } from './provider.js';
import { CLI_PROVIDER_META } from './catalog.js';
import { parseStructuredOutput, zodToJsonSchema } from './cli-json.js';
import { resolveBinary, runCommand } from './cli-process.js';
import type { CliProviderId } from './ai-provider-id.js';

function requiredBinary(provider: CliProviderId): string {
  const command = resolveBinary(CLI_PROVIDER_META[provider].binaries);
  if (!command) {
    throw new Error(`${CLI_PROVIDER_META[provider].label}이(가) 설치되어 있지 않습니다.`);
  }
  return command;
}

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), 'ax-cli-'));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function composedPrompt(input: { system: string; user?: string; messages?: import('./chat.js').ChatMessage[] }): string {
  return flattenChatPrompt(input.system, chatMessagesFromInput(input));
}

export class CodexCliProvider implements ModelProvider {
  readonly name = 'codex-cli';

  constructor(private model: string) {}

  async generateText(input: TextGenerateInput): Promise<string> {
    const command = requiredBinary('codex-cli');
    return withTempDir(async (dir) => {
      const outPath = join(dir, 'last.txt');
      const result = await runCommand(
        command,
        [
          'exec',
          '--skip-git-repo-check',
          '--sandbox',
          'read-only',
          '--ask-for-approval',
          'never',
          '--ephemeral',
          '--color',
          'never',
          '-m',
          this.model,
          '-o',
          outPath,
          composedPrompt(input),
        ],
        { timeoutMs: 180_000 },
      );
      try {
        return (await readFile(outPath, 'utf8')).trim();
      } catch {
        return result.stdout.trim() || result.stderr.trim();
      }
    });
  }

  async generateStructured<T>(input: StructuredGenerateInput<T>): Promise<T> {
    const command = requiredBinary('codex-cli');
    const schema = zodToJsonSchema(input.schema);
    const raw = await withTempDir(async (dir) => {
      const schemaPath = join(dir, 'schema.json');
      const outPath = join(dir, 'last.txt');
      await writeFile(schemaPath, JSON.stringify(schema), 'utf8');
      const result = await runCommand(
        command,
        [
          'exec',
          '--skip-git-repo-check',
          '--sandbox',
          'read-only',
          '--ask-for-approval',
          'never',
          '--ephemeral',
          '--color',
          'never',
          '-m',
          this.model,
          '--output-schema',
          schemaPath,
          '-o',
          outPath,
          composedPrompt(input),
        ],
        { timeoutMs: 180_000 },
      );
      try {
        return await readFile(outPath, 'utf8');
      } catch {
        return result.stdout || result.stderr;
      }
    });
    return parseStructuredOutput(raw, input.schema);
  }
}

export class ClaudeCliProvider implements ModelProvider {
  readonly name = 'claude-cli';

  constructor(private model: string) {}

  async generateText(input: TextGenerateInput): Promise<string> {
    const command = requiredBinary('claude-cli');
    const result = await runCommand(
      command,
      [
        '-p',
        composedPrompt(input),
        '--model',
        this.model,
        '--output-format',
        'text',
        '--max-turns',
        '1',
        '--permission-mode',
        'dontAsk',
      ],
      { timeoutMs: 180_000 },
    );
    if (result.exitCode !== 0 && !result.stdout.trim()) {
      throw new Error(result.stderr.trim() || 'Claude CLI 호출에 실패했습니다.');
    }
    return result.stdout.trim();
  }

  async generateStructured<T>(input: StructuredGenerateInput<T>): Promise<T> {
    const command = requiredBinary('claude-cli');
    const schema = JSON.stringify(zodToJsonSchema(input.schema));
    const result = await runCommand(
      command,
      [
        '-p',
        composedPrompt(input),
        '--model',
        this.model,
        '--output-format',
        'json',
        '--json-schema',
        schema,
        '--max-turns',
        '1',
        '--permission-mode',
        'dontAsk',
      ],
      { timeoutMs: 180_000 },
    );
    if (result.exitCode !== 0 && !result.stdout.trim()) {
      throw new Error(result.stderr.trim() || 'Claude CLI 호출에 실패했습니다.');
    }
    return parseStructuredOutput(result.stdout || result.stderr, input.schema);
  }
}

export class CursorCliProvider implements ModelProvider {
  readonly name = 'cursor-cli';

  constructor(private model: string) {}

  private runAgent(outputFormat: 'text' | 'json', prompt: string) {
    const command = requiredBinary('cursor-cli');
    if (!process.env.CURSOR_API_KEY?.trim()) {
      throw new Error('CURSOR_API_KEY가 설정되지 않았습니다. 설정에서 API 키를 등록하세요.');
    }
    return runCommand(
      command,
      [
        '--print',
        '--mode',
        'ask',
        '--model',
        this.model,
        '--output-format',
        outputFormat,
        '--trust',
        prompt,
      ],
      { timeoutMs: 180_000 },
    );
  }

  async generateText(input: TextGenerateInput): Promise<string> {
    const result = await this.runAgent('text', composedPrompt(input));
    if (result.exitCode !== 0 && !result.stdout.trim()) {
      throw new Error(result.stderr.trim() || 'Cursor CLI 호출에 실패했습니다.');
    }
    return result.stdout.trim();
  }

  async generateStructured<T>(input: StructuredGenerateInput<T>): Promise<T> {
    const prompt = `${composedPrompt(input)}\n\nReturn JSON only that matches the schema. No markdown.`;
    const result = await this.runAgent('json', prompt);
    if (result.exitCode !== 0 && !result.stdout.trim()) {
      throw new Error(result.stderr.trim() || 'Cursor CLI 호출에 실패했습니다.');
    }
    return parseStructuredOutput(result.stdout || result.stderr, input.schema);
  }
}

export function createCliModelProvider(provider: CliProviderId, model: string): ModelProvider {
  if (provider === 'codex-cli') return new CodexCliProvider(model);
  if (provider === 'cursor-cli') return new CursorCliProvider(model);
  return new ClaudeCliProvider(model);
}
