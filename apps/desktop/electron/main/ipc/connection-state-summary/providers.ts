import {
  getHttpConnectionStatus,
  getWebhookConnectionStatus,
  parseGmailConnectionConfig,
} from '@ax-studio/core';
import type { ConnectionSummaryOptions } from './contracts.js';

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
  };
}

export function summarizeHttpConnection(
  connected: boolean,
  config: Record<string, unknown> | undefined,
): Record<string, unknown> {
  const status = getHttpConnectionStatus(config, connected);
  const record = (config && typeof config === 'object' ? config : {}) as Record<string, unknown>;
  // Legacy singular fields mirror the first ready endpoint; the new
  // `endpoints` shape stores authHeader/username per endpoint.
  const first = status.endpoints[0];
  return {
    connector: 'http',
    connected: status.connected,
    label: status.label,
    baseUrl: status.baseUrl,
    authType: status.authType,
    authHeader: first?.authHeader ?? (typeof record.authHeader === 'string' ? record.authHeader : undefined),
    username: first?.username ?? (typeof record.username === 'string' ? record.username : undefined),
    endpoints: status.endpoints,
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
