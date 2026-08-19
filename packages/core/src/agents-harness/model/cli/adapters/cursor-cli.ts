import { HARNESS_TASK_PROMPT, writeHarnessTaskFile } from '../../../task-file.js';
import type { ModelProvider, StructuredGenerateInput, TextGenerateInput } from '../../provider.js';
import { runCommand } from '../../cli-process.js';
import { composedPrompt, requiredBinary, withTempDir } from '../shared.js';
import { parseStructuredFromCliResult, pickCliOutput, readableCliError } from '../output.js';

export class CursorCliProvider implements ModelProvider {
  readonly name = 'cursor-cli';

  constructor(private model: string) {}

  private async runAgent(outputFormat: 'text' | 'json', prompt: string) {
    const command = requiredBinary('cursor-cli');
    return withTempDir(async (dir) => {
      await writeHarnessTaskFile(dir, prompt);
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
          '--sandbox',
          'enabled',
          '--workspace',
          dir,
          '--',
          HARNESS_TASK_PROMPT,
        ],
        { timeoutMs: 90_000, cwd: dir },
      );
    });
  }

  async generateText(input: TextGenerateInput): Promise<string> {
    const result = await this.runAgent('text', composedPrompt(input));
    const raw = pickCliOutput(result);
    if (!raw) {
      throw new Error(readableCliError(result.stderr, 'Cursor CLI 호출에 실패했습니다.'));
    }
    return raw;
  }

  async generateStructured<T>(input: StructuredGenerateInput<T>): Promise<T> {
    const prompt = `${composedPrompt(input)}\n\nReturn JSON only that matches the schema. No markdown.`;
    const result = await this.runAgent('json', prompt);
    return parseStructuredFromCliResult(result, input.schema, 'Cursor CLI 호출에 실패했습니다.');
  }
}
