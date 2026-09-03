import {
  SlackConnector,
  parseSlackConnectionConfig,
  type WorkflowRuntime,
  type WorkflowStore,
} from '@ax-studio/core';
import { getSlackSecret, saveSlackSecret } from './secrets.js';
import { SLACK_SECRET_READ_ERROR, type SlackSecret } from './contracts.js';
import { persistedSlackMetadata } from './metadata.js';

/** Load secure Slack tokens and migrate the legacy plaintext DB record once. */
export async function hydrateSlackConnector(store: WorkflowStore, runtime: WorkflowRuntime): Promise<SlackSecret | null> {
  const connection = store.getConnections().find((entry) => entry.connector === 'slack');
  if (!connection?.connected) return null;

  let secret: SlackSecret | null = null;
  let secretReadFailed = false;
  try {
    secret = await getSlackSecret();
  } catch {
    // A stale OS-encrypted value must not prevent the application from
    // starting; the user needs a chance to replace it from Settings.
    secretReadFailed = true;
  }
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
    store.setConnection(
      'slack',
      false,
      secretReadFailed
        ? { ...persistedSlackMetadata(connection.config), lastError: SLACK_SECRET_READ_ERROR }
        : undefined,
    );
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
