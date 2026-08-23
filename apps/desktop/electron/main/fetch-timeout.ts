const DEFAULT_VERIFY_TIMEOUT_MS = 10_000;

export async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit = {},
  timeoutMs = DEFAULT_VERIFY_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } catch (error) {
    if ((error as Error).name === 'AbortError') {
      throw new Error(`요청 시간이 초과되었습니다 (${Math.round(timeoutMs / 1000)}초).`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
