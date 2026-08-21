export function resolveGmailMessageId(params: Record<string, unknown>): string | undefined {
  const direct = params.messageId;
  if (typeof direct === 'string' && direct.trim()) return direct.trim();

  const message = params.message;
  if (message && typeof message === 'object' && !Array.isArray(message)) {
    const record = message as Record<string, unknown>;
    const nested = record.messageId ?? record.id;
    if (typeof nested === 'string' && nested.trim()) return nested.trim();
  }

  const rootId = params.id;
  if (typeof rootId === 'string' && rootId.trim()) return rootId.trim();

  return undefined;
}
