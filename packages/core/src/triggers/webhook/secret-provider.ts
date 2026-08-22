function readInlineSecret(config: unknown): string | null {
  if (!config || typeof config !== 'object' || Array.isArray(config)) return null;
  const secret = (config as Record<string, unknown>).secret;
  return typeof secret === 'string' && secret.trim() ? secret.trim() : null;
}

export type WebhookSecretResolver = (config: unknown) => Promise<string | null> | string | null;

let resolver: WebhookSecretResolver | null = null;

export function setWebhookSecretResolver(next: WebhookSecretResolver | null): void {
  resolver = next;
}

export async function resolveWebhookAuthSecret(config: unknown): Promise<string | null> {
  if (resolver) {
    const resolved = await resolver(config);
    if (resolved?.trim()) return resolved.trim();
  }
  return readInlineSecret(config);
}
