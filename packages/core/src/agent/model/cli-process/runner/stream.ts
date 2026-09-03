import { spawn } from 'node:child_process';
import { commandInvocation } from '../environment.js';
import type { CommandResult } from '../contracts.js';
import { commandArgumentLimitError, MAX_STREAM_OUTPUT_BYTES } from './limits.js';

export interface RunCommandStreamingOptions {
  timeoutMs?: number;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  abortSignal?: AbortSignal;
  onStdoutLine?: (line: string) => void;
}

export function runCommandStreaming(
  command: string,
  args: string[],
  options: RunCommandStreamingOptions = {},
): Promise<CommandResult> {
  if (options.abortSignal?.aborted) {
    return Promise.reject(Object.assign(new Error('ABORT_ERR'), { code: 'ABORT_ERR' }));
  }
  const timeoutMs = options.timeoutMs ?? 15_000;
  const invocation = commandInvocation(command, args);
  const argumentError = commandArgumentLimitError(invocation);
  if (argumentError) return Promise.reject(argumentError);
  const env = options.env ? { ...invocation.env, ...options.env } : invocation.env;

  return new Promise((resolve, reject) => {
    const child = spawn(invocation.file, invocation.args, {
      env,
      cwd: options.cwd,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let lineBuf = '';
    let settled = false;

    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      options.abortSignal?.removeEventListener('abort', onAbort);
      if (error) {
        reject(error);
        return;
      }
      resolve({
        stdout,
        stderr,
        exitCode: child.exitCode ?? 0,
      });
    };

    const timer = setTimeout(() => {
      child.kill();
      finish(Object.assign(new Error('ETIMEDOUT'), { code: 'ETIMEDOUT' }));
    }, timeoutMs);

    const onAbort = () => {
      child.kill();
      finish(Object.assign(new Error('ABORT_ERR'), { code: 'ABORT_ERR' }));
    };
    options.abortSignal?.addEventListener('abort', onAbort, { once: true });

    child.stdout?.on('data', (chunk: Buffer | string) => {
      if (settled) return;
      const text = chunk.toString();
      stdout += text;
      if (Buffer.byteLength(stdout, 'utf8') > MAX_STREAM_OUTPUT_BYTES) {
        child.kill();
        finish(Object.assign(new Error('command_output_too_large'), { code: 'EOUTPUTTOOLARGE' }));
        return;
      }
      lineBuf += text;
      const lines = lineBuf.split(/\r?\n/);
      lineBuf = lines.pop() ?? '';
      for (const line of lines) {
        if (line.trim()) options.onStdoutLine?.(line);
      }
    });
    child.stderr?.on('data', (chunk: Buffer | string) => {
      if (settled) return;
      stderr += chunk.toString();
      if (Buffer.byteLength(stderr, 'utf8') > MAX_STREAM_OUTPUT_BYTES) {
        child.kill();
        finish(Object.assign(new Error('command_output_too_large'), { code: 'EOUTPUTTOOLARGE' }));
      }
    });
    child.on('error', (error) => finish(error));
    child.on('close', () => {
      if (settled) return;
      if (lineBuf.trim()) options.onStdoutLine?.(lineBuf);
      finish();
    });
  });
}
