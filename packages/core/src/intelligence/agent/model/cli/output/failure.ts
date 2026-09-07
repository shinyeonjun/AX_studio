import { readableCliError } from './readability.js';

function extractQuotedMessage(payload: string): string | null {
  const match = payload.match(/"message"\s*:\s*"((?:\\.|[^"\\])*)"/);
  if (!match) return null;
  try {
    return JSON.parse(`"${match[1]}"`) as string;
  } catch {
    return match[1];
  }
}

function usableCliErrorText(text: string | null | undefined): string | null {
  const trimmed = text?.trim() ?? '';
  if (!trimmed || trimmed === '{' || trimmed === '}' || trimmed === 'ERROR:') return null;
  if (/^[{\[]$/.test(trimmed)) return null;
  return trimmed;
}

function codexErrorFromStderr(stderr: string): string | null {
  const marker = stderr.search(/ERROR:\s*/i);
  if (marker >= 0) {
    const payload = stderr.slice(marker).replace(/^ERROR:\s*/i, '').trim();
    try {
      const parsed = JSON.parse(payload) as { error?: { message?: string } };
      const message = parsed.error?.message?.trim();
      if (message) return message;
    } catch {
      const quoted = extractQuotedMessage(payload);
      if (quoted) return quoted;
    }
  }

  for (const line of stderr.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('ERROR:')) continue;
    const payload = trimmed.slice('ERROR:'.length).trim();
    try {
      const parsed = JSON.parse(payload) as { error?: { message?: string } };
      const message = parsed.error?.message?.trim();
      if (message) return message;
    } catch {
      const quoted = extractQuotedMessage(payload);
      if (quoted) return quoted;
      const usable = usableCliErrorText(payload);
      if (usable) return usable.slice(0, 500);
    }
  }
  return null;
}

export function cliFailureMessage(
  result: { stdout: string; stderr: string; exitCode: number },
  fallbackMessage: string,
): string | null {
  if (result.exitCode === 0) return null;
  const codexError = codexErrorFromStderr(result.stderr);
  if (codexError) return codexError;
  const stderr = usableCliErrorText(
    readableCliError(result.stderr, '').replace(/^ERROR:\s*/i, ''),
  );
  if (stderr) return stderr;
  const stdout = result.stdout.trim();
  if (stdout.startsWith('Error:')) return stdout;
  return fallbackMessage;
}

export function usableCliFailureText(text: string | null | undefined): string | null {
  return usableCliErrorText(text);
}
