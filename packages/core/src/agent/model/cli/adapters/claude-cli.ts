import type { ModelProvider, StructuredGenerateInput, TextGenerateInput } from '../../provider.js';
import { zodToJsonSchema } from '../../cli-json.js';
import { runCommand } from '../../cli-process.js';
import { composedPrompt, requiredBinary } from '../shared.js';
import { parseStructuredFromCliResult } from '../output.js';

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
      { timeoutMs: input.timeoutMs ?? 180_000, abortSignal: input.abortSignal },
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
      { timeoutMs: input.timeoutMs ?? 180_000, abortSignal: input.abortSignal },
    );
    return parseStructuredFromCliResult(result, input.schema, 'Claude CLI 호출에 실패했습니다.');
  }
}
