type GmailPart = {
  mimeType?: string | null;
  filename?: string | null;
  headers?: Array<{ name?: string | null; value?: string | null }> | null;
  body?: { data?: string | null; size?: number | null } | null;
  parts?: GmailPart[] | null;
};

function decodeBase64Url(data: string): string {
  const normalized = data.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(normalized, 'base64').toString('utf8');
}

function isAttachment(part: GmailPart): boolean {
  if (part.filename?.trim()) return true;
  return (part.headers ?? []).some(
    (header) =>
      header.name?.toLowerCase() === 'content-disposition'
      && /^\s*attachment(?:\s*;|\s*$)/i.test(header.value ?? ''),
  );
}

function collectPlainText(part: GmailPart | undefined, chunks: string[]): void {
  if (!part) return;
  const mimeType = part.mimeType ?? '';
  if ((mimeType === 'text/plain' || mimeType === 'text/html') && part.body?.data) {
    chunks.push(decodeBase64Url(part.body.data));
    return;
  }
  for (const child of part.parts ?? []) {
    collectPlainText(child, chunks);
  }
}

/** Extract readable body text from Gmail API message payload. */
export function extractGmailPlainBody(message: unknown): string | undefined {
  if (!message || typeof message !== 'object') return undefined;
  const record = message as Record<string, unknown>;
  if (typeof record.body === 'string' && record.body.trim()) {
    return record.body;
  }
  const payload = record.payload as GmailPart | undefined;
  if (!payload) return typeof record.snippet === 'string' ? record.snippet : undefined;

  const plain: string[] = [];
  const html: string[] = [];
  const walk = (part: GmailPart | undefined) => {
    if (!part) return;
    if (isAttachment(part)) return;
    const mimeType = part.mimeType ?? '';
    if (part.body?.data) {
      const text = decodeBase64Url(part.body.data);
      if (mimeType === 'text/plain') plain.push(text);
      else if (mimeType === 'text/html') html.push(text);
      return;
    }
    for (const child of part.parts ?? []) walk(child);
  };
  walk(payload);

  if (plain.length > 0) return plain.join('\n\n').trim();
  if (html.length > 0) return html.join('\n\n').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  return typeof record.snippet === 'string' ? record.snippet : undefined;
}
