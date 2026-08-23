import {
  SlackConnector,
  parseSlackConnectionConfig,
  type WorkflowRuntime,
  type WorkflowStore,
} from '@ax-studio/core';
import { deleteOsSecret, getOsSecret, setOsSecret } from '../credential-store.js';

const SLACK_SECRET_NAME = 'slack.tokens';

export interface SlackSecret {
  token: string;
  appToken?: string;
}

function parseSlackSecret(value: string | null): SlackSecret | null {
  if (!value) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const record = parsed as Record<string, unknown>;
    if (typeof record.token !== 'string' || !record.token.trim()) return null;
    return {
      token: record.token.trim(),
      appToken: typeof record.appToken === 'string' && record.appToken.trim() ? record.appToken.trim() : undefined,
    };
  } catch {
    return null;
  }
}

export async function getSlackSecret(): Promise<SlackSecret | null> {
  return parseSlackSecret(await getOsSecret(SLACK_SECRET_NAME));
}

export async function saveSlackSecret(secret: SlackSecret): Promise<void> {
  await setOsSecret(SLACK_SECRET_NAME, JSON.stringify(secret));
}

export async function deleteSlackSecret(): Promise<void> {
  await deleteOsSecret(SLACK_SECRET_NAME);
}

/** Load secure Slack tokens and migrate the legacy plaintext DB record once. */
export async function hydrateSlackConnector(store: WorkflowStore, runtime: WorkflowRuntime): Promise<SlackSecret | null> {
  const connection = store.getConnections().find((entry) => entry.connector === 'slack');
  if (!connection?.connected) return null;

  let secret = await getSlackSecret();
  const legacy = parseSlackConnectionConfig(connection.config);
  if (!secret && legacy) {
    secret = legacy;
    await saveSlackSecret(secret);
    store.setConnection('slack', true, {
      team: (connection.config as { team?: unknown } | undefined)?.team,
      botUser: (connection.config as { botUser?: unknown } | undefined)?.botUser,
      connectedAt: (connection.config as { connectedAt?: unknown } | undefined)?.connectedAt,
      tokenStored: true,
      appTokenStored: Boolean(secret.appToken),
    });
  }

  if (!secret) {
    store.setConnection('slack', false);
    return null;
  }

  const metadata = (connection.config ?? {}) as {
    team?: unknown;
    botUser?: unknown;
    connectedAt?: unknown;
    lastError?: unknown;
  };
  store.setConnection('slack', true, {
    team: typeof metadata.team === 'string' ? metadata.team : undefined,
    botUser: typeof metadata.botUser === 'string' ? metadata.botUser : undefined,
    connectedAt: typeof metadata.connectedAt === 'string' ? metadata.connectedAt : undefined,
    tokenStored: true,
    appTokenStored: Boolean(secret.appToken),
    ...(typeof metadata.lastError === 'string' ? { lastError: metadata.lastError } : {}),
  });
  runtime.setConnector('slack', new SlackConnector(secret.token));
  return secret;
}
