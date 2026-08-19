import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ModelProvider, StructuredGenerateInput, TextGenerateInput } from '../../provider.js';
import { parseStructuredOutput, zodToJsonSchema } from '../../cli-json.js';
import { runCommand } from '../../cli-process.js';
import { composedPrompt, requiredBinary, withTempDir } from '../shared.js';

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
