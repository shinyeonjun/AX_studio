import {
  getHttpConnectionStatus,
  getWebhookConnectionStatus,
  parseGmailConnectionConfig,
} from '@ax-studio/core';
import type { ConnectionSummaryOptions } from './contracts.js';
import { readHttpSecrets } from '../../http/connection/secrets.js';

export function summarizeGmailConnection(
  connected: boolean,
  config: Record<string, unknown> | undefined,
): Record<string, unknown> {
  const gmail = parseGmailConnectionConfig(config);
  return {
    connector: 'gmail',
    connected,
    account: gmail?.account,
    scopes: gmail?.scopes,
    // Why it needs attention (sign-in expired, saved login unreadable): the card shows it.
    ...(typeof config?.lastError === 'string' ? { lastError: config.lastError } : {}),
  };
}

/**
 * An endpoint whose login was saved but whose secret this computer can no longer read is not
 * usable (the connector leaves it out); settings says "다시 연결 필요" instead of counting it.
 */
async function endpointsMissingSecret(endpoints: Array<{ id: string; authType?: string }>): Promise<Set<string>> {
  const needingSecret = endpoints.filter((endpoint) => (endpoint.authType ?? 'none') !== 'none');
  if (needingSecret.length === 0) return new Set();
  let secrets: Record<string, unknown> = {};
  try {
    secrets = await readHttpSecrets();
  } catch {
    secrets = {};
  }
  return new Set(needingSecret.filter((endpoint) => !secrets[endpoint.id]).map((endpoint) => endpoint.id));
}

export async function summarizeHttpConnection(
  connected: boolean,
  config: Record<string, unknown> | undefined,
): Promise<Record<string, unknown>> {
  const status = getHttpConnectionStatus(config, connected);
  const missing = await endpointsMissingSecret(status.endpoints);
  const endpoints = status.endpoints.map((endpoint) => (missing.has(endpoint.id) ? { ...endpoint, needsReconnect: true } : endpoint));
  const record = (config && typeof config === 'object' ? config : {}) as Record<string, unknown>;
  // Legacy singular fields mirror the first ready endpoint; the new
  // `endpoints` shape stores authHeader/username per endpoint.
  const first = status.endpoints[0];
  return {
    connector: 'http',
    connected: status.connected && endpoints.some((endpoint) => !('needsReconnect' in endpoint)),
    label: status.label,
    baseUrl: status.baseUrl,
    authType: status.authType,
    authHeader: first?.authHeader ?? (typeof record.authHeader === 'string' ? record.authHeader : undefined),
    username: first?.username ?? (typeof record.username === 'string' ? record.username : undefined),
    endpoints,
    ...(typeof record.lastError === 'string' ? { lastError: record.lastError } : {}),
  };
}

export function summarizeWebhookConnection(
  connected: boolean,
  config: Record<string, unknown> | undefined,
  options: ConnectionSummaryOptions,
): Record<string, unknown> {
  const status = getWebhookConnectionStatus(config, connected);
  const listenerStatus = options.webhookTransport?.phase;
  const listenerHealthy = listenerStatus === undefined || listenerStatus === 'connected';
  return {
    connector: 'webhook',
    connected: status.connected && listenerHealthy,
    label: status.label,
    port: status.port,
    localBaseUrl: status.localBaseUrl,
    tunnelUrl: status.tunnelUrl,
    ...(listenerStatus ? { listenerStatus } : {}),
    ...(options.webhookTransport?.error || status.lastError
      ? { lastError: options.webhookTransport?.error ?? status.lastError }
      : {}),
  };
}
