import { execFile } from 'node:child_process';
import { commandInvocation } from '../environment.js';
import type { CommandResult } from '../contracts.js';
import { commandArgumentLimitError, MAX_STREAM_OUTPUT_BYTES } from './limits.js';
import { runCommandStreaming, type RunCommandStreamingOptions } from './stream.js';

export interface RunCommandOptions extends RunCommandStreamingOptions {
  input?: string;
}

export function runCommand(
  command: string,
  args: string[],
  options: RunCommandOptions = {},
): Promise<CommandResult> {
  if (options.onStdoutLine) {
    return runCommandStreaming(command, args, options);
  }
  const timeoutMs = options.timeoutMs ?? 15_000;
  const invocation = commandInvocation(command, args);
  const argumentError = commandArgumentLimitError(invocation);
  if (argumentError) return Promise.reject(argumentError);
  const env = options.env ? { ...invocation.env, ...options.env } : invocation.env;

  return new Promise((resolve, reject) => {
    const child = execFile(
      invocation.file,
      invocation.args,
      {
        env,
        timeout: timeoutMs,
        maxBuffer: MAX_STREAM_OUTPUT_BYTES,
        windowsHide: true,
        cwd: options.cwd,
        signal: options.abortSignal,
      },
      (error, stdout, stderr) => {
        const code = error && 'code' in error ? error.code : 0;
        const exitCode = typeof code === 'number' ? code : error ? 1 : 0;
        if (error && (code === 'ETIMEDOUT' || code === 'ABORT_ERR')) {
          reject(error);
          return;
        }
        const stdoutText = stdout?.toString() ?? '';
        const stderrText = stderr?.toString() ?? '';
        resolve({
          stdout: stdoutText,
          stderr: stderrText || (error ? error.message : ''),
          exitCode: error ? exitCode || 1 : 0,
        });
      },
    );
    if (options.input !== undefined) child.stdin?.write(options.input);
    child.stdin?.end();
  });
}
