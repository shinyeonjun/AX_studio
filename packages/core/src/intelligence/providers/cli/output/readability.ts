/** Bound CLI diagnostics so error messages never echo large prompt or document fragments. */
const MAX_CLI_ERROR_CHARS = 2_048;

export function truncateCliText(text: string, limit = MAX_CLI_ERROR_CHARS): string {
  return text.length > limit ? `${text.slice(0, limit)}…` : text;
}

export function readableCliError(stderr: string, fallback: string): string {
  const lines = stderr
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  return truncateCliText(lines.join('\n')) || fallback;
}

/** Model output only ever comes from stdout; stderr is diagnostics. */
export function pickCliOutput(result: { stdout: string }): string {
  return result.stdout.trim();
}
