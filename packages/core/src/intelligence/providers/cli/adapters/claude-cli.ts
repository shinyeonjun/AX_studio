import type { ModelProvider, StructuredGenerateInput, TextGenerateInput } from '../../provider.js';
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

export class ClaudeCliProvider implements ModelProvider {
  readonly name = 'claude-cli';

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
    const result = await this.run(input, ['--output-format', 'text']);
    const failure = cliFailureMessage(result, FAILURE_MESSAGE);
    if (failure) throw new Error(failure);
    const text = result.stdout.trim();
    if (!text) throw new Error(FAILURE_MESSAGE);
    return text;
  }

  async generateStructured<T>(input: StructuredGenerateInput<T>): Promise<T> {
    const schema = JSON.stringify(zodToJsonSchema(input.schema));
    const result = await this.run(input, ['--output-format', 'json', '--json-schema', schema]);
    return parseStructuredFromCliResult(result, input.schema, FAILURE_MESSAGE);
  }
}
