/**
 * Webhook shared secrets live only in the OS credential store (via the
 * resolver the desktop host installs). Inline `config.secret` values are no
 * longer read; the desktop host migrates any legacy inline secret on startup.
 */
export type WebhookSecretResolver = (config: unknown) => Promise<string | null> | string | null;

let resolver: WebhookSecretResolver | null = null;

export function setWebhookSecretResolver(next: WebhookSecretResolver | null): void {
  resolver = next;
}

export async function resolveWebhookAuthSecret(config: unknown): Promise<string | null> {
  if (!resolver) return null;
  const resolved = await resolver(config);
  return resolved?.trim() ? resolved.trim() : null;
}
