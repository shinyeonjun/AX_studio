import type { CommandResult } from '../contracts.js';
import { runCommandStreaming, type RunCommandStreamingOptions } from './stream.js';

export type RunCommandOptions = RunCommandStreamingOptions;

/** Buffered and line-streamed commands share cancellation and child ownership. */
export function runCommand(
  command: string,
  args: string[],
  options: RunCommandOptions = {},
): Promise<CommandResult> {
  return runCommandStreaming(command, args, options);
}
