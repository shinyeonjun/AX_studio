export function isCursorNoiseLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) return true;
  return (
    trimmed.startsWith('cursor-retrieval:') ||
    trimmed.includes('cursor_retrieval.') ||
    (trimmed.startsWith('tracing to ') && trimmed.includes('.log'))
  );
}

export function readableCliError(stderr: string, fallback: string): string {
  const lines = stderr
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !isCursorNoiseLine(line));
  return lines.join('\n') || fallback;
}

export function pickCliOutput(result: { stdout: string; stderr: string }): string {
  const stdout = result.stdout.trim();
  if (stdout) return stdout;
  const stderr = result.stderr
    .split(/\r?\n/)
    .filter((line) => !isCursorNoiseLine(line))
    .join('\n')
    .trim();
  return stderr;
}
