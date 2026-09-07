import { spawn } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';
import { commandInvocation } from '../environment.js';
import type { CommandResult } from '../contracts.js';
import { commandArgumentLimitError, MAX_STREAM_OUTPUT_BYTES } from './limits.js';
import { commandProcesses, terminateOwnedChild } from './ownership.js';

export interface RunCommandStreamingOptions {
  input?: string;
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
  try { commandProcesses.assertAccepting(); } catch (error) { return Promise.reject(error); }
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
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    commandProcesses.track(child);

    let stdout = '';
    let stderr = '';
    let lineBuf = '';
    const stdoutDecoder = new StringDecoder('utf8');
    const stderrDecoder = new StringDecoder('utf8');
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let settled = false;
    let terminationError: Error | undefined;
    let escalationTimer: ReturnType<typeof setTimeout> | undefined;
    let terminationTimer: ReturnType<typeof setTimeout> | undefined;

    const finish = (error?: Error, exitCode = child.exitCode ?? 1) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(escalationTimer);
      clearTimeout(terminationTimer);
      options.abortSignal?.removeEventListener('abort', onAbort);
      if (error) {
        reject(error);
        return;
      }
      resolve({
        stdout,
        stderr,
        exitCode,
      });
    };

    const terminate = (error: Error) => {
      if (settled || terminationError) return;
      terminationError = error;
      terminateOwnedChild(child);
      escalationTimer = setTimeout(() => terminateOwnedChild(child, true), 1_000);
      terminationTimer = setTimeout(() => finish(Object.assign(
        new Error('Child termination was not acknowledged', { cause: error }),
        { code: 'command_termination_failed' },
      )), 5_000);
    };
    const timer = setTimeout(() => {
      terminate(Object.assign(new Error('ETIMEDOUT'), { code: 'ETIMEDOUT' }));
    }, timeoutMs);

    const onAbort = () => {
      terminate(Object.assign(new Error('ABORT_ERR'), { code: 'ABORT_ERR' }));
    };
    options.abortSignal?.addEventListener('abort', onAbort, { once: true });
    if (options.abortSignal?.aborted) onAbort();
    child.stdin?.on('error', (error: NodeJS.ErrnoException) => {
      if (error.code !== 'EPIPE') terminate(error);
    });
    child.stdin?.end(options.input);

    child.stdout?.on('data', (chunk: Buffer | string) => {
      if (settled || terminationError) return;
      const bytes = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
      stdoutBytes += bytes.length;
      if (stdoutBytes > MAX_STREAM_OUTPUT_BYTES) {
        terminate(Object.assign(new Error('command_output_too_large'), { code: 'EOUTPUTTOOLARGE' }));
        return;
      }
      const text = stdoutDecoder.write(bytes);
      stdout += text;
      if (!options.onStdoutLine) return;
      lineBuf += text;
      const lines = lineBuf.split(/\r?\n/);
      lineBuf = lines.pop() ?? '';
      for (const line of lines) {
        if (line.trim()) {
          try { options.onStdoutLine(line); }
          catch (error) { terminate(error instanceof Error ? error : new Error(String(error))); return; }
        }
      }
    });
    child.stderr?.on('data', (chunk: Buffer | string) => {
      if (settled || terminationError) return;
      const bytes = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
      stderrBytes += bytes.length;
      if (stderrBytes > MAX_STREAM_OUTPUT_BYTES) {
        terminate(Object.assign(new Error('command_output_too_large'), { code: 'EOUTPUTTOOLARGE' }));
        return;
      }
      stderr += stderrDecoder.write(bytes);
    });
    child.on('error', (error) => finish(error));
    child.on('close', (code: number | null) => {
      if (settled) return;
      const finalText = stdoutDecoder.end();
      stdout += finalText;
      stderr += stderrDecoder.end();
      if (options.onStdoutLine) lineBuf += finalText;
      if (!terminationError && lineBuf.trim()) {
        try { options.onStdoutLine?.(lineBuf); }
        catch (error) { finish(error instanceof Error ? error : new Error(String(error))); return; }
      }
      if (terminationError) finish(terminationError);
      else {
        // The close event is authoritative, including signal-only exits.
        finish(undefined, code ?? 1);
      }
    });
  });
}
