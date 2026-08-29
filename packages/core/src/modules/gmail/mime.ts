/** RFC 2047 encoded-word for non-ASCII header values (Subject, etc.). */
export function encodeMimeHeaderValue(value: string): string {
  assertSingleLineHeaderValue(value, 'subject');
  if (/^[\t\x20-\x7E]*$/.test(value)) return value;

  const words: string[] = [];
  let chunk = '';
  for (const character of value) {
    if (chunk && Buffer.byteLength(chunk + character, 'utf8') > 45) {
      words.push(`=?UTF-8?B?${Buffer.from(chunk, 'utf8').toString('base64')}?=`);
      chunk = '';
    }
    chunk += character;
  }
  if (chunk) words.push(`=?UTF-8?B?${Buffer.from(chunk, 'utf8').toString('base64')}?=`);
  return words.join('\r\n ');
}

function assertSingleLineHeaderValue(value: string, name: string): void {
  if (/[\r\n]/.test(value)) {
    throw new Error(`gmail_${name}_header_invalid`);
  }
}

export function buildPlainTextMime(params: {
  to: string;
  subject: string;
  body: string;
  from?: string;
}): string {
  assertSingleLineHeaderValue(params.to, 'to');
  if (params.from) assertSingleLineHeaderValue(params.from, 'from');
  const subject = encodeMimeHeaderValue(params.subject);
  const bodyBase64 = Buffer.from(params.body, 'utf8').toString('base64');
  const headers = [
    `To: ${params.to}`,
    ...(params.from ? [`From: ${params.from}`] : []),
    `Subject: ${subject}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    bodyBase64,
  ];
  return headers.join('\r\n');
}

export function buildGmailRawMessage(params: {
  to: string;
  subject: string;
  body: string;
  from?: string;
}): string {
  return Buffer.from(buildPlainTextMime(params)).toString('base64url');
}
