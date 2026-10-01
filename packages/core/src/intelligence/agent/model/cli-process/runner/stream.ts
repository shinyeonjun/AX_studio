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
  /** Skip only the returned stdout buffer; line callbacks and byte limits still apply. */
  captureStdout?: boolean;
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
      child.stdin?.removeListener('error', onStdinError);
      child.stdout?.removeListener('data', onStdoutData);
      child.stderr?.removeListener('data', onStderrData);
      child.removeListener('error', onChildError);
      child.removeListener('close', onChildClose);
      const result = { stdout, stderr, exitCode };
      // A child that failed to terminate stays in the ownership registry. Its
      // callbacks must not retain this request's buffers or caller context.
      stdout = '';
      stderr = '';
      lineBuf = '';
      if (error) {
        reject(error);
        return;
      }
      resolve(result);
    };

    const terminate = (error: Error) => {
      if (settled || terminationError) return;
      terminationError = error;
      terminateOwnedChild(child);
      if (settled) return;
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
    const onStdinError = (error: NodeJS.ErrnoException) => {
      if (error.code !== 'EPIPE') terminate(error);
    };

    const onStdoutData = (chunk: Buffer | string) => {
      if (settled || terminationError) return;
      const bytes = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
      stdoutBytes += bytes.length;
      if (stdoutBytes > MAX_STREAM_OUTPUT_BYTES) {
        terminate(Object.assign(new Error('command_output_too_large'), { code: 'EOUTPUTTOOLARGE' }));
        return;
      }
      const text = stdoutDecoder.write(bytes);
      if (options.captureStdout !== false) stdout += text;
      if (!options.onStdoutLine) return;
      lineBuf += text;
      // Only new text can add an LF. Avoid rescanning a growing unterminated line.
      if (!text.includes('\n')) return;
      const lines = lineBuf.split(/\r?\n/);
      lineBuf = lines.pop() ?? '';
      for (const line of lines) {
        if (line.trim()) {
          try { options.onStdoutLine(line); }
          catch (error) { terminate(error instanceof Error ? error : new Error(String(error))); return; }
        }
      }
    };
    const onStderrData = (chunk: Buffer | string) => {
      if (settled || terminationError) return;
      const bytes = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
      stderrBytes += bytes.length;
      if (stderrBytes > MAX_STREAM_OUTPUT_BYTES) {
        terminate(Object.assign(new Error('command_output_too_large'), { code: 'EOUTPUTTOOLARGE' }));
        return;
      }
      stderr += stderrDecoder.write(bytes);
    };
    const onChildError = (error: Error) => {
      // Spawn failure has no child to reap. Errors on a live process still
      // require termination and close acknowledgement before settling.
      if (child.pid === undefined || child.exitCode != null || child.signalCode != null) finish(error);
      else terminate(error);
    };
    const onChildClose = (code: number | null) => {
      if (settled) return;
      const finalText = stdoutDecoder.end();
      if (options.captureStdout !== false) stdout += finalText;
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
    };
    child.stdin?.on('error', onStdinError);
    child.stdout?.on('data', onStdoutData);
    child.stderr?.on('data', onStderrData);
    child.on('error', onChildError);
    child.on('close', onChildClose);
    options.abortSignal?.addEventListener('abort', onAbort, { once: true });
    if (options.abortSignal?.aborted) onAbort();
    if (!settled && !terminationError) {
      try { child.stdin?.end(options.input); }
      catch (error) { terminate(error instanceof Error ? error : new Error(String(error))); }
    }
  });
}
