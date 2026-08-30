const DEFAULT_VERIFY_TIMEOUT_MS = 10_000;

export async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit = {},
  timeoutMs = DEFAULT_VERIFY_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const timeoutError = new Error(
    `요청 시간이 초과되었습니다 (${Math.round(timeoutMs / 1000)}초).`,
  );
  const timer = setTimeout(() => {
    controller.abort(timeoutError);
  }, timeoutMs);
  const signal = init.signal
    ? AbortSignal.any([init.signal, controller.signal])
    : controller.signal;
  try {
    return await fetch(input, { ...init, signal });
  } catch (error) {
    if (signal.reason === timeoutError) {
      throw timeoutError;
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
