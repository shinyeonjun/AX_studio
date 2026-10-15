import { reportModelTokenUsage, type ModelProvider, type StructuredGenerateInput, type TextGenerateInput } from '../../provider.js';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { zodToJsonSchema } from '../../cli-json.js';
import { runCommand, type CommandResult } from '../../cli-process.js';
import { supportedCliFlags } from '../capabilities.js';
import { requiredBinary, withTempDir } from '../shared.js';
import { chatMessagesFromInput, flattenChatPrompt } from '../../chat.js';
import { cliFailureMessage, parseStructuredFromCliResult } from '../output.js';

const FAILURE_MESSAGE = 'Claude CLI 호출에 실패했습니다.';
const ISOLATION_FLAGS = [
  '--tools',
  '--setting-sources',
  '--strict-mcp-config',
  '--no-session-persistence',
  '--disable-slash-commands',
] as const;
/** Fallback for CLI builds without `--tools`. */
const DENIED_TOOLS = 'Bash Edit MultiEdit Write NotebookEdit Read Glob Grep WebFetch WebSearch Task';

/**
 * Prompts carry untrusted mail/document text, so the CLI runs as a bare model call:
 * no built-in tools, no MCP servers, no user/project settings or hooks, no saved session.
 */
async function claudeIsolationArgs(command: string): Promise<string[]> {
  const supported = await supportedCliFlags(command, ['--help'], ISOLATION_FLAGS);
  return [
    ...(supported.has('--tools') ? ['--tools', ''] : ['--disallowedTools', DENIED_TOOLS]),
    ...(supported.has('--setting-sources') ? ['--setting-sources', ''] : []),
    ...(supported.has('--strict-mcp-config') ? ['--strict-mcp-config'] : []),
    ...(supported.has('--no-session-persistence') ? ['--no-session-persistence'] : []),
    ...(supported.has('--disable-slash-commands') ? ['--disable-slash-commands'] : []),
  ];
}

interface ClaudeCliEnvelope {
  result?: unknown;
  structured_output?: unknown;
  is_error?: unknown;
  usage?: Record<string, unknown>;
}

const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);

/**
 * The one user turn sent over `--input-format stream-json`: the conversation as text, with any
 * images as content blocks ahead of it. The system prompt goes in its own file instead, which
 * replaces the CLI's default instructions (about 2,900 tokens per call down to about 700).
 */
function userTurn(input: TextGenerateInput | StructuredGenerateInput<unknown>): string {
  const images = (input.images ?? []).map((image) => {
    if (!IMAGE_TYPES.has(image.mimeType)) {
      throw Object.assign(new Error('Unsupported image format'), { code: 'image_format_unsupported' });
    }
    if (!image.data.byteLength) throw Object.assign(new Error('Empty image input'), { code: 'image_input_empty' });
    return { type: 'image', source: { type: 'base64', media_type: image.mimeType, data: Buffer.from(image.data).toString('base64') } };
  });
  const text = flattenChatPrompt('', chatMessagesFromInput(input)).trim();
  return `${JSON.stringify({ type: 'user', message: { role: 'user', content: [...images, { type: 'text', text }] } })}\n`;
}

/** The final `result` event of a stream-json run (reply, structured output, usage). */
function readResultEvent(stdout: string): ClaudeCliEnvelope | undefined {
  let found: ClaudeCliEnvelope | undefined;
  for (const line of stdout.split(/\r?\n/u)) {
    if (!line.includes('"result"')) continue;
    try {
      const parsed: unknown = JSON.parse(line);
      if (parsed && typeof parsed === 'object' && (parsed as { type?: unknown }).type === 'result') found = parsed as ClaudeCliEnvelope;
    } catch { /* not an event line */ }
  }
  return found;
}

/** Token counts from the result event, in Anthropic's terms (input without cache reads and writes). */
function reportEnvelopeUsage(input: TextGenerateInput | StructuredGenerateInput<unknown>, envelope: ClaudeCliEnvelope | undefined): void {
  const usage = envelope?.usage;
  if (!usage) return;
  const count = (value: unknown) => (typeof value === 'number' ? value : undefined);
  const details = usage.output_tokens_details as Record<string, unknown> | undefined;
  reportModelTokenUsage(input, {
    inputTokens: count(usage.input_tokens),
    outputTokens: count(usage.output_tokens),
    cachedInputTokens: count(usage.cache_read_input_tokens),
    cacheWriteInputTokens: count(usage.cache_creation_input_tokens),
    reasoningTokens: count(details?.thinking_tokens),
  });
}

export class ClaudeCliProvider implements ModelProvider {
  readonly name = 'claude-cli';
  readonly usageInputExcludesCache = true;
  readonly supportsVision = true;

  constructor(readonly model: string) {}

  private async run(
    input: TextGenerateInput | StructuredGenerateInput<unknown>,
    extraArgs: string[] = [],
  ): Promise<CommandResult> {
    const command = await requiredBinary('claude-cli');
    const isolation = await claudeIsolationArgs(command);
    const turn = userTurn(input);
    return withTempDir(async (dir) => {
      const systemPath = join(dir, 'system.md');
      await writeFile(systemPath, input.system, 'utf8');
      return runCommand(
        command,
        [
          '-p',
          '--model',
          this.model,
          '--input-format',
          'stream-json',
          '--output-format',
          'stream-json',
          '--verbose',
          '--system-prompt-file',
          systemPath,
          ...extraArgs,
          '--max-turns',
          String(input.maxTurns ?? 1),
          '--permission-mode',
          'dontAsk',
          ...isolation,
        ],
        { input: turn, cwd: dir, timeoutMs: input.timeoutMs ?? 180_000, abortSignal: input.abortSignal },
      );
    });
  }

  async generateText(input: TextGenerateInput): Promise<string> {
    const result = await this.run(input);
    const failure = cliFailureMessage(result, FAILURE_MESSAGE);
    if (failure) throw new Error(failure);
    const envelope = readResultEvent(result.stdout);
    reportEnvelopeUsage(input, envelope);
    if (!envelope || envelope.is_error === true || typeof envelope.result !== 'string') throw new Error(FAILURE_MESSAGE);
    const text = envelope.result.trim();
    if (!text) throw new Error(FAILURE_MESSAGE);
    return text;
  }

  async generateStructured<T>(input: StructuredGenerateInput<T>): Promise<T> {
    const schema = JSON.stringify(zodToJsonSchema(input.schema));
    const result = await this.run(input, ['--json-schema', schema]);
    const envelope = result.exitCode === 0 ? readResultEvent(result.stdout) : undefined;
    reportEnvelopeUsage(input, envelope);
    if (result.exitCode === 0 && (!envelope || envelope.is_error === true)) throw new Error(FAILURE_MESSAGE);
    // The structured answer, as text, through the same parsing and error handling as before.
    const answer = envelope?.structured_output !== undefined ? JSON.stringify(envelope.structured_output) : typeof envelope?.result === 'string' ? envelope.result : '';
    return parseStructuredFromCliResult({ ...result, stdout: answer }, input.schema, FAILURE_MESSAGE);
  }
}
