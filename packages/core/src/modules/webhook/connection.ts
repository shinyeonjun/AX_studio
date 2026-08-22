export interface WebhookConnectionConfig {
  port: number;
  tunnelUrl?: string;
  label?: string;
  secretStored?: boolean;
  connectedAt?: string;
  lastError?: string;
}

export interface WebhookConnectionRecord {
  port?: number;
  tunnelUrl?: string;
  label?: string;
  secretStored?: boolean;
  connectedAt?: string;
  lastError?: string;
}

export interface WebhookConnectionStatus {
  connected: boolean;
  port?: number;
  tunnelUrl?: string;
  label?: string;
  localBaseUrl?: string;
  lastError?: string;
}

export function parseWebhookConnectionConfig(config: unknown): WebhookConnectionConfig | null {
  if (!config || typeof config !== 'object' || Array.isArray(config)) return null;
  const record = config as WebhookConnectionRecord;
  const port = typeof record.port === 'number' && Number.isInteger(record.port) ? record.port : 18_789;
  if (port < 1 || port > 65_535) return null;
  return {
    port,
    tunnelUrl: typeof record.tunnelUrl === 'string' ? record.tunnelUrl.trim() || undefined : undefined,
    label: typeof record.label === 'string' ? record.label.trim() || undefined : undefined,
    secretStored: record.secretStored === true,
    connectedAt: typeof record.connectedAt === 'string' ? record.connectedAt : undefined,
    lastError: typeof record.lastError === 'string' ? record.lastError : undefined,
  };
}

export function mergeWebhookSecret(
  config: WebhookConnectionConfig,
  secret: string | null | undefined,
): (WebhookConnectionConfig & { secret: string }) | null {
  if (!secret?.trim()) return null;
  return { ...config, secret: secret.trim() };
}

export function getWebhookConnectionStatus(config: unknown, connected: boolean): WebhookConnectionStatus {
  const parsed = parseWebhookConnectionConfig(config);
  const record = (config && typeof config === 'object' ? config : {}) as WebhookConnectionRecord;
  const secretReady = record.secretStored === true;

  if (!connected || !parsed || !secretReady) {
    return { connected: false, lastError: record.lastError };
  }

  return {
    connected: true,
    port: parsed.port,
    tunnelUrl: parsed.tunnelUrl,
    label: parsed.label,
    localBaseUrl: `http://127.0.0.1:${parsed.port}/hooks/`,
    lastError: parsed.lastError,
  };
}
