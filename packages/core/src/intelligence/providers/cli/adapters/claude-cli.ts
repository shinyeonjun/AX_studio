import { reportModelTokenUsage, type ModelProvider, type StructuredGenerateInput, type TextGenerateInput } from '../../provider.js';
import { zodToJsonSchema } from '../../cli-json.js';
import { runCommand, type CommandResult } from '../../cli-process.js';
import { supportedCliFlags } from '../capabilities.js';
import { composedPrompt, requiredBinary, withTempDir } from '../shared.js';
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
  is_error?: unknown;
  usage?: Record<string, unknown>;
}

/** The JSON envelope `--output-format json` prints, or undefined for plain text. */
function readEnvelope(stdout: string): ClaudeCliEnvelope | undefined {
  const text = stdout.trim();
  if (!text.startsWith('{')) return undefined;
  try {
    const parsed: unknown = JSON.parse(text);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as ClaudeCliEnvelope : undefined;
  } catch {
    return undefined;
  }
}

/** Token counts from the envelope, in Anthropic's terms (input without cache reads and writes). */
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

  constructor(readonly model: string) {}

  private async run(
    input: TextGenerateInput | StructuredGenerateInput<unknown>,
    outputArgs: string[],
  ): Promise<CommandResult> {
    const command = await requiredBinary('claude-cli');
    const isolation = await claudeIsolationArgs(command);
    return withTempDir((dir) => runCommand(
      command,
      [
        '-p',
        '--model',
        this.model,
        ...outputArgs,
        '--max-turns',
        String(input.maxTurns ?? 1),
        '--permission-mode',
        'dontAsk',
        ...isolation,
      ],
      { input: composedPrompt(input), cwd: dir, timeoutMs: input.timeoutMs ?? 180_000, abortSignal: input.abortSignal },
    ));
  }

  async generateText(input: TextGenerateInput): Promise<string> {
    // JSON carries the token counts; the reply is its `result`.
    const result = await this.run(input, ['--output-format', 'json']);
    const failure = cliFailureMessage(result, FAILURE_MESSAGE);
    if (failure) throw new Error(failure);
    const envelope = readEnvelope(result.stdout);
    reportEnvelopeUsage(input, envelope);
    if (envelope?.is_error === true) throw new Error(FAILURE_MESSAGE);
    const text = (envelope && typeof envelope.result === 'string' ? envelope.result : result.stdout).trim();
    if (!text) throw new Error(FAILURE_MESSAGE);
    return text;
  }

  async generateStructured<T>(input: StructuredGenerateInput<T>): Promise<T> {
    const schema = JSON.stringify(zodToJsonSchema(input.schema));
    const result = await this.run(input, ['--output-format', 'json', '--json-schema', schema]);
    if (result.exitCode === 0) reportEnvelopeUsage(input, readEnvelope(result.stdout));
    return parseStructuredFromCliResult(result, input.schema, FAILURE_MESSAGE);
  }
}
