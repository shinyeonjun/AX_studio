export function ipcErrorMessage(error: unknown, fallback = '요청 처리에 실패했습니다.'): string {
  const raw = error instanceof Error ? error.message : String(error);
  const nested = raw.match(/Error invoking remote method '[^']+': Error: (.+)/);
  if (nested?.[1]) return nested[1].trim();
  return raw.replace(/^Error:\s*/, '').trim() || fallback;
}
