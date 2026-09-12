const DEFAULT_VERIFY_TIMEOUT_MS = 10_000;
const MAX_RESPONSE_BYTES = 1_048_576;

function timedSignal(init: RequestInit, timeoutMs: number): {
  signal: AbortSignal;
  timeoutError: Error;
  timer: ReturnType<typeof setTimeout>;
} {
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
  return { signal, timeoutError, timer };
}


/** Fetches and consumes a response under one deadline, including the body. */
export async function fetchTextWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit = {},
  timeoutMs = DEFAULT_VERIFY_TIMEOUT_MS,
): Promise<{ response: Response; text: string }> {
  const { signal, timeoutError, timer } = timedSignal(init, timeoutMs);
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  const textDecoder = new TextDecoder();
  try {
    const response = await fetch(input, { ...init, signal });
    reader = response.body?.getReader();
    const declaredLength = Number(response.headers.get('content-length'));
    if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) {
      throw new Error('응답 본문이 너무 큽니다.');
    }
    if (!reader) return { response, text: '' };
    const chunks: string[] = [];
    let byteLength = 0;
    const cancelReader = () => {
      void reader?.cancel(signal.reason).catch(() => undefined);
    };
    signal.addEventListener('abort', cancelReader, { once: true });
    try {
      while (true) {
        if (signal.aborted) throw signal.reason;
        const { done, value } = await reader.read();
        if (done) break;
        byteLength += value.byteLength;
        if (byteLength > MAX_RESPONSE_BYTES) throw new Error('응답 본문이 너무 큽니다.');
        chunks.push(textDecoder.decode(value, { stream: true }));
      }
      chunks.push(textDecoder.decode());
    } finally {
      signal.removeEventListener('abort', cancelReader);
    }
    if (signal.aborted) throw signal.reason;
    return { response, text: chunks.join('') };
  } catch (error) {
    if (signal.reason === timeoutError) throw timeoutError;
    throw error;
  } finally {
    clearTimeout(timer);
    if (reader) await reader.cancel().catch(() => undefined);
  }
}
