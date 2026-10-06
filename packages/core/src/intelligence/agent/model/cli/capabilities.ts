import { runCommand } from '../cli-process.js';

const helpTexts = new Map<string, Promise<string | null>>();

function readHelp(command: string, helpArgs: string[]): Promise<string | null> {
  const key = `${command}\0${helpArgs.join('\0')}`;
  let pending = helpTexts.get(key);
  if (!pending) {
    pending = runCommand(command, helpArgs, { timeoutMs: 8_000 })
      .then((result) => `${result.stdout}\n${result.stderr}`)
      .catch(() => {
        helpTexts.delete(key);
        return null;
      });
    helpTexts.set(key, pending);
  }
  return pending;
}

/**
 * Isolation flags vary across installed CLI versions; passing an unknown flag aborts the run.
 * When help cannot be read the flags are assumed present, so the CLI fails closed.
 */
export async function supportedCliFlags(
  command: string,
  helpArgs: string[],
  flags: readonly string[],
): Promise<Set<string>> {
  const help = await readHelp(command, helpArgs);
  if (help === null) return new Set(flags);
  return new Set(flags.filter((flag) => help.includes(flag)));
}
