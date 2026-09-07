import type { CommandInvocation } from '../contracts.js';

export const MAX_STREAM_OUTPUT_BYTES = 8 * 1024 * 1024;
const MAX_COMMAND_ARGUMENT_BYTES = process.platform === 'win32' ? 24 * 1024 : 256 * 1024;

function commandArgumentBytes(invocation: CommandInvocation): number {
  return Buffer.byteLength([invocation.file, ...invocation.args].join(' '), 'utf8');
}

export function commandArgumentLimitError(invocation: CommandInvocation): Error | undefined {
  const bytes = commandArgumentBytes(invocation);
  if (bytes <= MAX_COMMAND_ARGUMENT_BYTES) return undefined;
  return Object.assign(
    new Error(
      `command arguments are too large (${bytes} bytes; limit ${MAX_COMMAND_ARGUMENT_BYTES}). Pass large data through stdin or a temporary file.`,
    ),
    { code: 'EARGTOOLARGE', bytes, limit: MAX_COMMAND_ARGUMENT_BYTES },
  );
}
