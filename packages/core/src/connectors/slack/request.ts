export async function slackRequest<T extends { ok?: boolean; error?: string }>(
  request: () => Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  signal?.throwIfAborted();
  const response = await request();
  signal?.throwIfAborted();
  if (response.ok === false) throw new Error(response.error || 'slack_error');
  return response;
}

/** Longest Retry-After a read waits out; a longer one fails now so a run is never stalled. */
const MAX_READ_RATE_LIMIT_WAIT_MS = 15_000;
const MAX_READ_RATE_LIMIT_RETRIES = 2;

function rateLimitWaitMs(error: unknown): number | undefined {
  const coded = error as { code?: unknown; retryAfter?: unknown } | null;
  if (coded?.code !== 'slack_webapi_rate_limited_error') return undefined;
  const seconds = typeof coded.retryAfter === 'number' && Number.isFinite(coded.retryAfter) ? coded.retryAfter : 1;
  return Math.max(0, seconds) * 1_000;
}

function waitFor(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const onAbort = () => { clearTimeout(timer); reject(signal!.reason); };
    const timer = setTimeout(() => { signal?.removeEventListener('abort', onAbort); resolve(); }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * A read that waits out a short Slack rate limit instead of failing a long multi-page read half
 * way. Only reads: nothing is sent twice. A long wait, or a third limit in a row, fails as before.
 */
export async function slackRead<T extends { ok?: boolean; error?: string }>(
  request: () => Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await slackRequest(request, signal);
    } catch (error) {
      const waitMs = rateLimitWaitMs(error);
      if (waitMs === undefined || waitMs > MAX_READ_RATE_LIMIT_WAIT_MS || attempt >= MAX_READ_RATE_LIMIT_RETRIES) throw error;
      await waitFor(waitMs, signal);
    }
  }
}
