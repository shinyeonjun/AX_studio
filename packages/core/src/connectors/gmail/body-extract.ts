type GmailPart = {
  mimeType?: string | null;
  filename?: string | null;
  headers?: Array<{ name?: string | null; value?: string | null }> | null;
  body?: { data?: string | null; size?: number | null } | null;
  parts?: GmailPart[] | null;
};

/** The part's declared charset (Korean mail is often euc-kr / ks_c_5601-1987), if any. */
function partCharset(part: GmailPart): string | undefined {
  const contentType = (part.headers ?? []).find((header) => header.name?.toLowerCase() === 'content-type')?.value ?? '';
  const match = /charset\s*=\s*"?([^";\s]+)"?/i.exec(contentType);
  return match?.[1]?.toLowerCase();
}

function decodeBase64Url(data: string, charset?: string): string {
  const normalized = data.replace(/-/g, '+').replace(/_/g, '/');
  const bytes = Buffer.from(normalized, 'base64');
  if (charset && charset !== 'utf-8' && charset !== 'utf8' && charset !== 'us-ascii') {
    try {
      // WHATWG labels cover euc-kr, ks_c_5601-1987, cp949, iso-8859-*, windows-125x, shift_jis …
      return new TextDecoder(charset).decode(bytes);
    } catch {
      // Unknown label: fall back to UTF-8 rather than failing the read.
    }
  }
  return bytes.toString('utf8');
}

function isAttachment(part: GmailPart): boolean {
  if (part.filename?.trim()) return true;
  return (part.headers ?? []).some(
    (header) =>
      header.name?.toLowerCase() === 'content-disposition'
      && /^\s*attachment(?:\s*;|\s*$)/i.test(header.value ?? ''),
  );
}

const HTML_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

function decodeHtmlEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entity, name: string) => {
    if (name.startsWith('#')) {
      const code = name[1]?.toLowerCase() === 'x' ? Number.parseInt(name.slice(2), 16) : Number(name.slice(1));
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : entity;
    }
    return HTML_ENTITIES[name.toLowerCase()] ?? entity;
  });
}

function htmlToPlainText(html: string): string {
  const text = html
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, ' ')
    // Line and block breaks stay line breaks; the rest of the markup goes.
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr|h[1-6])\s*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ');
  return decodeHtmlEntities(text)
    .split('\n')
    .map((line) => line.replace(/[ \t\f\v ]+/g, ' ').trim())
    .filter((line, index, lines) => line !== '' || (index > 0 && lines[index - 1] !== ''))
    .join('\n')
    .trim();
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
      const text = decodeBase64Url(part.body.data, partCharset(part));
      if (mimeType === 'text/plain') plain.push(text);
      else if (mimeType === 'text/html') html.push(text);
      return;
    }
    for (const child of part.parts ?? []) walk(child);
  };
  walk(payload);

  if (plain.length > 0) return plain.join('\n\n').trim();
  if (html.length > 0) return htmlToPlainText(html.join('\n\n'));
  return typeof record.snippet === 'string' ? record.snippet : undefined;
}

const READ_HEADERS: Array<[header: string, label: string]> = [['from', '보낸 사람'], ['subject', '제목'], ['date', '받은 시각']];

/**
 * Who sent a message and what it is about, as lines a reader (or an AI writing a notification)
 * can use ("보낸 사람: …", "제목: …"). Header values are message data, never instructions.
 */
export function gmailHeaderLines(message: unknown): string[] {
  const headers = (message as { payload?: { headers?: Array<{ name?: unknown; value?: unknown }> } } | undefined)?.payload?.headers;
  if (!Array.isArray(headers)) return [];
  return READ_HEADERS.flatMap(([header, label]) => {
    const value = headers.find((entry) => typeof entry?.name === 'string' && entry.name.toLowerCase() === header)?.value;
    return typeof value === 'string' && value.trim() ? [`${label}: ${value.trim().slice(0, 300)}`] : [];
  });
}
