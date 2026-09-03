export async function readBodyWithLimit(
  response: Response,
  maxBytes: number,
): Promise<{ body: string; truncated: boolean }> {
  const contentLength = response.headers.get('content-length');
  if (contentLength) {
    const declared = Number(contentLength);
    if (Number.isFinite(declared) && declared > maxBytes) {
      await response.body?.cancel().catch(() => undefined);
      return { body: '', truncated: true };
    }
  }

  if (!response.body) {
    return { body: '', truncated: false };
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let truncated = false;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;

      if (total + value.byteLength > maxBytes) {
        const remaining = maxBytes - total;
        if (remaining > 0) chunks.push(value.subarray(0, remaining));
        truncated = true;
        await reader.cancel().catch(() => undefined);
        break;
      }

      chunks.push(value);
      total += value.byteLength;
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = Buffer.concat(chunks);
  const body = truncated
    ? new TextDecoder().decode(bytes, { stream: true })
    : bytes.toString('utf8');
  return { body, truncated };
}
