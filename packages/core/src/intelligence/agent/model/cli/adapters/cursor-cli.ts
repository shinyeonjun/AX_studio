import { platform } from 'node:os';
import { CursorSessions } from './cursor-sessions.js';
import { HARNESS_TASK_PROMPT, writeHarnessTaskFile } from '../harness-task.js';
import type { ModelProvider, StructuredGenerateInput, TextGenerateInput } from '../../provider.js';
import { runCommand } from '../../cli-process.js';
import { composedPrompt, requiredBinary, withTempDir } from '../shared.js';
import {
  cursorProgressFromEvent,
  cursorResultTextFromEvent,
  cursorSessionIdFromEvent,
  parseCursorStreamLine,
  parseStructuredFromCliResult,
  pickCliOutput,
  readableCliError,
  cliFailureMessage,
} from '../output.js';

export class CursorCliProvider implements ModelProvider {
  readonly name = 'cursor-cli';
  private readonly sessions = new CursorSessions();

  constructor(readonly model: string) {}

  dispose(): Promise<void> { return this.sessions.dispose(); }

  private async runAgent(input: TextGenerateInput | StructuredGenerateInput<unknown>) {
    const command = requiredBinary('cursor-cli');
    const session = input.sessionId ? await this.sessions.acquire(input.sessionId) : undefined;
    const timeoutMs = input.timeoutMs ?? 90_000;
    const resume = Boolean(session?.resume);
    const prompt = composedPrompt(input, { resume });

    const invoke = async (dir: string) => {
      await writeHarnessTaskFile(dir, prompt);
      // Sandbox is macOS/Linux only; Windows needs allowlist mode (sandbox disabled).
      const sandboxMode = platform() === 'win32' ? 'disabled' : 'enabled';
      const args = [
        '--print',
        '--mode',
        'ask',
        '--model',
        this.model,
        '--output-format',
        'stream-json',
        '--trust',
        '--sandbox',
        sandboxMode,
        '--workspace',
        dir,
      ];
      if (session?.resume) {
        args.push('--resume', session.resume);
      }
      args.push('--', HARNESS_TASK_PROMPT);

      let capturedSession: string | undefined;
      let resultText = '';
      input.onProgress?.({ message: resume ? '이전 대화를 이어서 진행합니다' : '에이전트를 시작하고 있습니다' });

      const result = await runCommand(command, args, {
        timeoutMs,
        cwd: dir,
        abortSignal: input.abortSignal,
        onStdoutLine: (line) => {
          const event = parseCursorStreamLine(line);
          if (!event) return;
          const sid = cursorSessionIdFromEvent(event);
          if (sid) capturedSession = sid;
          const progress = cursorProgressFromEvent(event);
          if (progress) input.onProgress?.( { message: progress });
          const chunk = cursorResultTextFromEvent(event);
          if (chunk) resultText = chunk;
        },
      });

      if (capturedSession) session?.remember(capturedSession);

      return { ...result, stdout: resultText.trim() || result.stdout };
    };

    if (session) {
      try { return await invoke(session.dir); }
      catch (error) {
        if (error && typeof error === 'object' && 'code' in error && error.code === 'command_termination_failed') session.abandon();
        throw error;
      }
      finally { await session.release(); }
    }
    return withTempDir((dir) => invoke(dir));
  }

  async generateText(input: TextGenerateInput): Promise<string> {
    const result = await this.runAgent(input);
    const failure = cliFailureMessage(result, 'Cursor CLI 호출에 실패했습니다.');
    if (failure) throw new Error(failure);
    const raw = pickCliOutput(result);
    if (!raw) {
      throw new Error(readableCliError(result.stderr, 'Cursor CLI 호출에 실패했습니다.'));
    }
    if (raw.startsWith('Error:')) throw new Error(raw);
    return raw;
  }

  async generateStructured<T>(input: StructuredGenerateInput<T>): Promise<T> {
    const promptInput = {
      ...input,
      system: `${input.system}\n\nReturn JSON only that matches the schema. No markdown.`,
    };
    const result = await this.runAgent(promptInput);
    return parseStructuredFromCliResult(result, input.schema, 'Cursor CLI 호출에 실패했습니다.');
  }
}
