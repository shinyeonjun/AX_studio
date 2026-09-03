import type { ZodType } from 'zod';
import { parseStructuredOutput } from '../../cli-json.js';
import { cliFailureMessage, usableCliFailureText } from './failure.js';
import { pickCliOutput, readableCliError } from './readability.js';

function hasActionableStderr(stderr: string): boolean {
  return stderr
    .split(/\r?\n/)
    .some((line) => /(^|\s)(ERROR|Error|FATAL|fatal)(:|\s)/.test(line.trim()));
}

export async function parseStructuredFromCliResult<T>(
  result: { stdout: string; stderr: string; exitCode: number },
  schema: ZodType<T>,
  fallbackMessage: string,
): Promise<T> {
  const failure = cliFailureMessage(result, fallbackMessage);
  if (failure) {
    const usable = usableCliFailureText(failure);
    throw new Error(usable ?? fallbackMessage);
  }
  const raw = pickCliOutput(result);
  if (!raw) {
    throw new Error(readableCliError(result.stderr, fallbackMessage));
  }
  if (raw.startsWith('Error:')) {
    throw new Error(raw);
  }
  try {
    return parseStructuredOutput(raw, schema);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    const diagnostic = hasActionableStderr(result.stderr)
      ? readableCliError(result.stderr, '')
      : '';
    throw new Error(`${diagnostic ? `${diagnostic} ` : ''}(${detail})`);
  }
}
