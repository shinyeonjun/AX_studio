import {
  parseWebhookConnectionConfig,
  type WorkflowRuntime,
  type WorkflowStore,
} from '@ax-studio/core';
import { deleteOsSecret, getOsSecret, setOsSecret } from '../credential-store.js';

const WEBHOOK_SECRET_NAME = 'webhook.secret';

export async function getWebhookSecret(): Promise<string | null> {
  return getOsSecret(WEBHOOK_SECRET_NAME);
}

export async function saveWebhookSecret(secret: string): Promise<void> {
  await setOsSecret(WEBHOOK_SECRET_NAME, secret);
}

export async function deleteWebhookSecret(): Promise<void> {
  await deleteOsSecret(WEBHOOK_SECRET_NAME);
}

export async function validateAndConnectWebhook(
  store: WorkflowStore,
  runtime: WorkflowRuntime,
  payload: { port: number; secret: string; label?: string; tunnelUrl?: string },
  refreshTransports: () => Promise<void>,
): Promise<void> {
  const port = payload.port;
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error('포트 번호가 올바르지 않습니다.');
  }
  const secret = payload.secret.trim();
  if (!secret) throw new Error('Webhook 비밀을 입력해 주세요.');

  await saveWebhookSecret(secret);
  store.setConnection('webhook', true, {
    port,
    label: payload.label?.trim() || undefined,
    tunnelUrl: payload.tunnelUrl?.trim() || undefined,
    secretStored: true,
    connectedAt: new Date().toISOString(),
    lastError: undefined,
  });
  await refreshTransports();
}

export async function disconnectWebhook(
  store: WorkflowStore,
  refreshTransports: () => Promise<void>,
): Promise<void> {
  await deleteWebhookSecret();
  store.setConnection('webhook', false);
  await refreshTransports();
}

export async function hydrateWebhookConnection(store: WorkflowStore): Promise<void> {
  const connection = store.getConnections().find((entry) => entry.connector === 'webhook');
  if (!connection?.connected) return;
  const parsed = parseWebhookConnectionConfig(connection.config);
  const secret = await getWebhookSecret();
  if (!parsed || !secret) {
    store.setConnection('webhook', false);
  }
}
