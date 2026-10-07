const HANGUL = /[ㄱ-ㆎ가-힣]/u;

/**
 * The text an IPC result may carry as `error`. Our own Korean messages pass through; system
 * and library messages (English, codes, stack fragments) go to the log and become `fallback`.
 */
export function userFacingError(error: unknown, fallback: string): string {
  const message = (error instanceof Error ? error.message : String(error)).trim();
  if (message && HANGUL.test(message) && !/^\s*[[{]/.test(message)) return message;
  console.warn('[AX Studio] replaced a non-user-facing error message:', message);
  return fallback;
}
