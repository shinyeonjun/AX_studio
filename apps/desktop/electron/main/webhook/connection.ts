import {
  isWebhookSecretStrong,
  parseWebhookConnectionConfig,
  WEBHOOK_MIN_SECRET_LENGTH,
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

async function restoreWebhookSecret(previous: string | null): Promise<void> {
  if (previous) await saveWebhookSecret(previous);
  else await deleteWebhookSecret();
}

export async function validateAndConnectWebhook(
  store: WorkflowStore,
  payload: { port: number; secret: string; label?: string; tunnelUrl?: string },
  refreshTransports: () => Promise<void>,
): Promise<void> {
  const port = payload.port;
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error('포트 번호가 올바르지 않습니다.');
  }
  const previousSecret = (await getWebhookSecret())?.trim() || null;
  const secret = payload.secret.trim() || previousSecret || '';
  if (!secret) throw new Error('Webhook 비밀을 입력해 주세요.');
  if (!isWebhookSecretStrong(secret)) {
    throw new Error(`Webhook 비밀은 최소 ${WEBHOOK_MIN_SECRET_LENGTH}자 이상이어야 합니다.`);
  }

  const previousConnection = store.getConnections().find((entry) => entry.connector === 'webhook');
  // The listener reads the secret from the credential store, so the candidate
  // is stored before the restart and rolled back if the listener fails.
  if (secret !== previousSecret) await saveWebhookSecret(secret);
  const connectedAt = new Date().toISOString();
  const config = {
    port,
    label: payload.label?.trim() || undefined,
    tunnelUrl: payload.tunnelUrl?.trim() || undefined,
    secretStored: true,
    connectedAt,
    lastError: undefined,
  };
  store.setConnection('webhook', true, config);
  try {
    await refreshTransports();
  } catch (error) {
    const lastError = error instanceof Error ? error.message : String(error);
    if (secret !== previousSecret) await restoreWebhookSecret(previousSecret).catch(() => undefined);
    if (previousConnection?.connected && previousSecret) {
      // Keep the previously working listener instead of tearing it down.
      store.setConnection('webhook', true, { ...(previousConnection.config ?? {}), lastError });
      await refreshTransports().catch(() => undefined);
    } else {
      store.setConnection('webhook', false, { ...config, secretStored: Boolean(previousSecret), lastError });
    }
    throw error;
  }
}

export async function disconnectWebhook(
  store: WorkflowStore,
  refreshTransports: () => Promise<void>,
): Promise<void> {
  await deleteWebhookSecret();
  store.setConnection('webhook', false);
  await refreshTransports();
}

/**
 * Older builds could persist the shared secret inline in the connection config.
 * Move it to the OS credential store once and strip it from the database.
 */
async function migrateInlineWebhookSecret(
  store: WorkflowStore,
  connection: { connected: boolean; config?: Record<string, unknown> },
): Promise<void> {
  const config = connection.config;
  if (!config || !('secret' in config)) return;
  const { secret: inline, ...rest } = config;
  const stored = await getWebhookSecret();
  if (!stored && typeof inline === 'string' && inline.trim()) {
    await saveWebhookSecret(inline.trim());
    rest.secretStored = true;
  }
  store.setConnection('webhook', connection.connected, rest);
  if (typeof inline === 'string' && inline.trim() && !isWebhookSecretStrong(inline)) {
    console.warn(`[webhook] stored secret is shorter than ${WEBHOOK_MIN_SECRET_LENGTH} characters; rotate it in Settings.`);
  }
}

export async function hydrateWebhookConnection(store: WorkflowStore): Promise<void> {
  const existing = store.getConnections().find((entry) => entry.connector === 'webhook');
  if (existing) await migrateInlineWebhookSecret(store, existing);
  const connection = store.getConnections().find((entry) => entry.connector === 'webhook');
  if (!connection?.connected) return;
  const parsed = parseWebhookConnectionConfig(connection.config);
  const secret = await getWebhookSecret();
  if (!parsed || !secret) {
    store.setConnection('webhook', false);
  }
}
