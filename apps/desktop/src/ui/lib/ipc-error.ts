/** Validation output and other structured internals are not a message a person can act on. */
const STRUCTURED_DETAIL = /^\s*[[{]/;

export function ipcErrorMessage(error: unknown, fallback = '요청 처리에 실패했습니다.'): string {
  const raw = error instanceof Error ? error.message : String(error);
  const message = raw
    .replace(/^Error invoking remote method '[^']+':\s*/, '')
    .replace(/^\w*Error:\s*/, '')
    .trim();
  if (!message || STRUCTURED_DETAIL.test(message)) return fallback;
  return message;
}
